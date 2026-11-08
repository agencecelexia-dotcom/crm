-- Audit artisan 2026-11-08 : brouillons reprenables, sauvegarde idempotente,
-- arrondis identiques au PDF et accusé serveur avant le statut « envoyé ».
-- Aucune réécriture des montants ni des PDF des devis existants.

alter table public.devis
  add column if not exists idempotency_key uuid,
  add column if not exists revision integer not null default 0,
  add column if not exists pdf_revision integer,
  add column if not exists sauvegarde_empreinte text,
  add column if not exists document_data jsonb,
  add column if not exists email_html text,
  add column if not exists email_subject text,
  add column if not exists envoi_etat text,
  add column if not exists envoi_cle uuid,
  add column if not exists envoi_demarre_at timestamptz;
create unique index if not exists devis_idempotence on public.devis(artisan_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.creer_devis_by_token(p_token text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.artisans; af public.affectations; d public.devis;
  v_id uuid; v_cle uuid; v_num text; v_lignes jsonb;
  v_ht numeric; v_tva numeric; v_ttc numeric; v_acompte numeric;
  v_mode text; v_empreinte text; v_revision integer;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false, 'error', 'non_autorise'); end if;
  if not (coalesce(a.contrat_externe,false) or exists(select 1 from public.contrats where artisan_id=a.id and statut='signe')) then
    return json_build_object('ok', false, 'error', 'contrat_requis');
  end if;
  if not public.peut_chiffrer(a.id) then return json_build_object('ok', false, 'error', 'chiffrage_non_active'); end if;
  if nullif(btrim(p_payload->>'client_nom'), '') is null then return json_build_object('ok', false, 'error', 'client_requis'); end if;
  v_mode := coalesce(nullif(p_payload->>'tva_mode', ''), 'franchise');
  v_lignes := p_payload->'lignes';
  if v_mode not in ('normal', 'franchise') or jsonb_typeof(v_lignes) is distinct from 'array' then
    return json_build_object('ok', false, 'error', 'valeurs_invalides');
  end if;
  if jsonb_array_length(v_lignes) not between 1 and 500 then return json_build_object('ok', false, 'error', 'valeurs_invalides'); end if;
  if exists (select 1 from jsonb_array_elements(v_lignes) l where
      nullif(btrim(l->>'designation'), '') is null
      or coalesce(l->>'quantite', '') !~ '^[0-9]+(\.[0-9]+)?$'
      or coalesce(l->>'prix_unitaire', '') !~ '^[0-9]+(\.[0-9]+)?$'
      or (l->>'quantite')::numeric > 10000000
      or (l->>'prix_unitaire')::numeric > 10000000
      or (l->>'cout_unitaire' is not null and
          (l->>'cout_unitaire' !~ '^[0-9]+(\.[0-9]+)?$' or (l->>'cout_unitaire')::numeric > 10000000))
      or coalesce((l->>'tva_taux')::numeric, 0) not in (0, 2.1, 5.5, 10, 20)
  ) then return json_build_object('ok', false, 'error', 'valeurs_invalides'); end if;
  v_acompte := nullif(p_payload->>'acompte_pct', '')::numeric;
  if v_acompte is not null and (v_acompte < 0 or v_acompte > 100 or v_acompte::text in ('NaN','Infinity','-Infinity')) then
    return json_build_object('ok', false, 'error', 'valeurs_invalides');
  end if;
  -- La clé est conservée lors d'une réponse perdue et unique par artisan.
  v_cle := coalesce(nullif(p_payload->>'idempotency_key','')::uuid, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(a.id::text || v_cle::text, 0));
  if nullif(p_payload->>'devis_id','') is not null then
    select * into d from public.devis where id=(p_payload->>'devis_id')::uuid and artisan_id=a.id for update;
    if d.id is null then return json_build_object('ok', false, 'error', 'non_autorise'); end if;
  else
    select * into d from public.devis where artisan_id=a.id and idempotency_key=v_cle for update;
  end if;
  v_empreinte := public.empreinte((p_payload - 'devis_id' - 'idempotency_key' - 'expected_revision')::text);
  if d.id is not null then
    if d.statut <> 'brouillon' then return json_build_object('ok', false, 'error', 'devis_verrouille'); end if;
    if d.envoi_etat in ('en_cours','incertain','confirme') then return json_build_object('ok', false, 'error', 'envoi_a_verifier'); end if;
    -- Une réponse de sauvegarde perdue ne crée ni doublon ni révision supplémentaire.
    if d.sauvegarde_empreinte = v_empreinte then
      return json_build_object('ok',true,'id',d.id,'numero',d.numero,'revision',d.revision,'total_ht',d.total_ht,'total_ttc',d.total);
    end if;
    if nullif(p_payload->>'expected_revision','')::integer is distinct from d.revision then
      return json_build_object('ok',false,'error','revision_conflit');
    end if;

    select * into af from public.affectations where id=d.affectation_id and artisan_id=a.id;
    v_id := d.id; v_num := d.numero;
  elsif nullif(p_payload->>'affectation_token','') is not null then
    select * into af from public.affectations where token=p_payload->>'affectation_token' and artisan_id=a.id;
    if af.id is null then return json_build_object('ok', false, 'error', 'non_autorise'); end if;
  else
    -- Association automatique historique, uniquement sur un dossier vivant.
    select af3.* into af from public.affectations af3 join public.projets p3 on p3.id=af3.projet_id
     where af3.artisan_id=a.id and af3.retire_at is null and af3.masque_at is null and p3.statut <> 'mort' and af3.statut <> 'perdu' and p3.deleted_at is null
       and ((nullif(regexp_replace(coalesce(p_payload->>'client_tel',''),'\D','','g'),'') is not null
             and regexp_replace(coalesce(p3.client_telephone,''),'\D','','g')=regexp_replace(p_payload->>'client_tel','\D','','g'))
         or lower(btrim(p3.client_nom))=lower(btrim(p_payload->>'client_nom')))
     order by af3.created_at desc limit 1;
  end if;
  if af.id is not null and (af.retire_at is not null or af.masque_at is not null or exists(select 1 from public.projets where id=af.projet_id and (deleted_at is not null or statut='mort'))) then
    return json_build_object('ok', false, 'error', 'chantier_retire');
  end if;
  -- Normalise les taux en franchise ; arrondit chaque ligne puis chaque taux.
  select jsonb_agg(l || jsonb_build_object('tva_taux', case when v_mode='franchise' then 0 else coalesce((l->>'tva_taux')::numeric,0) end))
    into v_lignes from jsonb_array_elements(v_lignes) l;
  with lignes as (select round((l->>'quantite')::numeric*(l->>'prix_unitaire')::numeric,2) base,
    (l->>'tva_taux')::numeric taux from jsonb_array_elements(v_lignes) l),
  groupes as (select taux, sum(base) base from lignes group by taux)
  select coalesce(sum(base),0), coalesce(sum(round(base*taux/100,2)),0) into v_ht,v_tva from groupes;
  v_ttc := v_ht+v_tva;
  if v_ttc > 10000000 then return json_build_object('ok', false, 'error', 'valeurs_invalides'); end if;
  if v_id is null then
    v_num := 'DEV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.devis_seq')::text,4,'0');
    insert into public.devis(artisan_id,projet_id,affectation_id,numero,idempotency_key,lignes,total)
      values(a.id,af.projet_id,af.id,v_num,v_cle,v_lignes,v_ttc) returning id into v_id;
  end if;
  update public.devis set
    client_nom=btrim(p_payload->>'client_nom'), client_adresse=p_payload->>'client_adresse',
    client_cp=p_payload->>'client_cp', client_ville=p_payload->>'client_ville',
    client_email=btrim(p_payload->>'client_email'), client_tel=p_payload->>'client_tel',
    objet=p_payload->>'objet', lignes=v_lignes, total=v_ttc, total_ht=v_ht,total_tva=v_tva,tva_mode=v_mode,
    acompte_pct=v_acompte,conditions=p_payload->>'conditions',notes=p_payload->>'notes',
    date_validite=nullif(p_payload->>'date_validite','')::date,
    document_data=(p_payload->'document_data') || jsonb_build_object('numero',v_num,'lignes',v_lignes,'total',v_ttc,'totalHt',v_ht,'totalTva',v_tva),
    email_html=replace(p_payload->>'email_html','__NUMERO_DEVIS__',v_num),
    email_subject=replace(p_payload->>'email_subject','__NUMERO_DEVIS__',v_num),
    pdf_url=null, pdf_revision=null, envoi_etat=null, revision=revision+1, sauvegarde_empreinte=v_empreinte
  where id=v_id returning revision into v_revision;
  return json_build_object('ok',true,'id',v_id,'numero',v_num,'revision',v_revision,'total_ht',v_ht,'total_ttc',v_ttc);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  return json_build_object('ok',false,'error','valeurs_invalides');
end $$;

create or replace function public.devis_by_token(p_token text,p_devis_id uuid)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.artisans; d public.devis; v_token text;
begin
  a:=public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok',false,'error','non_autorise'); end if;
  if not (coalesce(a.contrat_externe,false) or exists(select 1 from public.contrats where artisan_id=a.id and statut='signe')) then
    return json_build_object('ok',false,'error','contrat_requis'); end if;
  select * into d from public.devis where id=p_devis_id and artisan_id=a.id;
  if d.id is null then return json_build_object('ok',false,'error','non_autorise'); end if;
  if d.statut <> 'brouillon' then return json_build_object('ok',false,'error','devis_verrouille'); end if;
  if d.envoi_etat in ('en_cours','incertain','confirme') then return json_build_object('ok',false,'error','envoi_a_verifier'); end if;
  select token into v_token from public.affectations where id=d.affectation_id and artisan_id=a.id and retire_at is null and masque_at is null
    and exists(select 1 from public.projets p where p.id=affectations.projet_id and p.deleted_at is null and p.statut <> 'mort');
  if d.affectation_id is not null and v_token is null then return json_build_object('ok',false,'error','chantier_retire'); end if;
  return json_build_object('ok',true,'devis',to_jsonb(d)||jsonb_build_object('affectation_token',v_token));
end $$;
revoke execute on function public.devis_by_token(text,uuid) from public;
grant execute on function public.devis_by_token(text,uuid) to anon,authenticated;

drop function if exists public.set_devis_pdf_by_token(text,uuid,text);
create or replace function public.set_devis_pdf_by_token(p_token text,p_devis_id uuid,p_url text,p_revision integer)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.artisans;
begin
  a:=public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok',false); end if;
  if p_url is null or p_url not like '%/storage/v1/object/public/devis/genere/' || public.empreinte(p_token) || '/%' then
    return json_build_object('ok',false,'error','pdf_invalide'); end if;
  update public.devis set pdf_url=p_url,pdf_revision=p_revision where id=p_devis_id and artisan_id=a.id and statut='brouillon' and revision=p_revision
    and coalesce(envoi_etat,'') not in ('en_cours','incertain','confirme');
  return case when found then json_build_object('ok',true) else json_build_object('ok',false,'error','revision_conflit') end;
end $$;
revoke execute on function public.set_devis_pdf_by_token(text,uuid,text,integer) from public;
grant execute on function public.set_devis_pdf_by_token(text,uuid,text,integer) to anon,authenticated;

-- Ces deux transitions ne sont exécutables que par l'edge server.
drop function if exists public.reserver_envoi_devis(text,uuid);
create or replace function public.reserver_envoi_devis(p_token text,p_devis_id uuid,p_revision integer)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.artisans; d public.devis; v_cle uuid;
begin
  a:=public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok',false,'error','non_autorise'); end if;
  if not (coalesce(a.contrat_externe,false) or exists(select 1 from public.contrats where artisan_id=a.id and statut='signe')) then
    return json_build_object('ok',false,'error','contrat_requis'); end if;
  select * into d from public.devis where id=p_devis_id and artisan_id=a.id for update;
  if d.id is null then return json_build_object('ok',false,'error','non_autorise'); end if;
  if d.revision is distinct from p_revision then return json_build_object('ok',false,'error','revision_conflit'); end if;
  if d.statut='envoye' then return json_build_object('ok',true,'deja_envoye',true); end if;
  if d.envoi_etat in ('en_cours','incertain','confirme') then return json_build_object('ok',false,'error','envoi_a_verifier'); end if;
  if not public.peut_chiffrer(a.id) then return json_build_object('ok',false,'error','chiffrage_non_active'); end if;
  if d.affectation_id is not null and not exists(select 1 from public.affectations af join public.projets p on p.id=af.projet_id
    where af.id=d.affectation_id and af.artisan_id=a.id and af.retire_at is null and af.masque_at is null and p.deleted_at is null and p.statut <> 'mort') then
    return json_build_object('ok',false,'error','chantier_retire'); end if;
  if coalesce(d.client_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return json_build_object('ok',false,'error','email_invalide'); end if;
  if d.pdf_url is null or d.pdf_revision is distinct from d.revision or d.email_html is null then return json_build_object('ok',false,'error','pdf_requis'); end if;
  v_cle:=gen_random_uuid();
  update public.devis set envoi_etat='en_cours',envoi_cle=v_cle,envoi_demarre_at=now(),envoi_pris_at=null where id=d.id;
  return json_build_object('ok',true,'cle',v_cle,'devis',to_jsonb(d));
end $$;

create or replace function public.finaliser_envoi_devis(p_token text,p_devis_id uuid,p_cle uuid,p_etat text)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.artisans; d public.devis; r json;
begin
  a:=public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok',false); end if;
  if p_etat not in ('confirme','incertain','echec') then return json_build_object('ok',false); end if;
  select * into d from public.devis where id=p_devis_id and artisan_id=a.id and envoi_cle=p_cle for update;
  if d.id is null then return json_build_object('ok',false); end if;
  if d.statut='envoye' then return json_build_object('ok',true,'deja_envoye',true); end if;
  update public.devis set envoi_etat=p_etat where id=d.id;
  if p_etat='confirme' then
    r:=public.envoyer_devis_by_token(p_token,p_devis_id);
    if coalesce((r->>'ok')::boolean,false) is false then raise exception 'Confirmation CRM impossible'; end if;
  end if;
  return json_build_object('ok',true);
end $$;
revoke execute on function public.reserver_envoi_devis(text,uuid,integer) from public,anon,authenticated;
revoke execute on function public.finaliser_envoi_devis(text,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.envoyer_devis_by_token(text,uuid) from public,anon,authenticated;
grant execute on function public.reserver_envoi_devis(text,uuid,integer) to service_role;
grant execute on function public.finaliser_envoi_devis(text,uuid,uuid,text) to service_role;
grant execute on function public.envoyer_devis_by_token(text,uuid) to service_role;

-- Une valeur facultative explicitement effacée doit réellement être effacée.
create or replace function public.enregistrer_identite_by_token(p_token text, p_payload jsonb)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_tva text;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  v_tva := nullif(btrim(coalesce(p_payload->>'tva_mode_defaut', '')), '');
  if v_tva is not null and v_tva not in ('franchise', 'normal') then
    return json_build_object('ok', false, 'error', 'tva_mode_invalide');
  end if;

  if p_payload ? 'acompte_defaut' and coalesce(p_payload->>'acompte_defaut','') <> '' then
    if (p_payload->>'acompte_defaut') !~ '^[0-9]+$' or (p_payload->>'acompte_defaut')::numeric > 100 then
      return json_build_object('ok', false, 'error', 'acompte_invalide');
    end if;
  end if;
  update public.artisans set
    societe               = case when p_payload ? 'societe' then nullif(btrim(p_payload->>'societe'), '') else societe end,
    adresse               = case when p_payload ? 'adresse' then nullif(btrim(p_payload->>'adresse'), '') else adresse end,
    code_postal           = case when p_payload ? 'code_postal' then nullif(btrim(p_payload->>'code_postal'), '') else code_postal end,
    ville                 = case when p_payload ? 'ville' then nullif(btrim(p_payload->>'ville'), '') else ville end,
    telephone             = case when p_payload ? 'telephone' then nullif(btrim(p_payload->>'telephone'), '') else telephone end,
    email                 = case when p_payload ? 'email' then nullif(btrim(p_payload->>'email'), '') else email end,
    siren                 = case when p_payload ? 'siren' then nullif(btrim(p_payload->>'siren'), '') else siren end,
    forme_juridique       = case when p_payload ? 'forme_juridique' then nullif(btrim(p_payload->>'forme_juridique'), '') else forme_juridique end,
    capital_social        = case when p_payload ? 'capital_social' then nullif(btrim(p_payload->>'capital_social'), '') else capital_social end,
    ville_immatriculation = case when p_payload ? 'ville_immatriculation' then nullif(btrim(p_payload->>'ville_immatriculation'), '') else ville_immatriculation end,
    logo_url              = case when p_payload ? 'logo_url' then nullif(btrim(p_payload->>'logo_url'), '') else logo_url end,
    tva_intracom          = case when p_payload ? 'tva_intracom' then nullif(btrim(p_payload->>'tva_intracom'), '') else tva_intracom end,
    code_ape              = case when p_payload ? 'code_ape' then nullif(btrim(p_payload->>'code_ape'), '') else code_ape end,
    iban                  = case when p_payload ? 'iban' then nullif(btrim(p_payload->>'iban'), '') else iban end,
    bic                   = case when p_payload ? 'bic' then nullif(btrim(p_payload->>'bic'), '') else bic end,
    mediateur_nom         = case when p_payload ? 'mediateur_nom' then nullif(btrim(p_payload->>'mediateur_nom'), '') else mediateur_nom end,
    mediateur_url         = case when p_payload ? 'mediateur_url' then nullif(btrim(p_payload->>'mediateur_url'), '') else mediateur_url end,
    conditions_paiement   = case when p_payload ? 'conditions_paiement' then nullif(btrim(p_payload->>'conditions_paiement'), '') else conditions_paiement end,
    garantie_zone         = case when p_payload ? 'garantie_zone' then nullif(btrim(p_payload->>'garantie_zone'), '') else garantie_zone end,
    acompte_defaut        = coalesce(nullif(p_payload->>'acompte_defaut', '')::int, acompte_defaut),
    tva_mode_defaut       = coalesce(v_tva, tva_mode_defaut),
    -- Les CGV sont le seul champ qu'on accepte de REMETTRE À ZÉRO : renvoyer
    -- une chaîne vide, c'est demander à revenir aux conditions par défaut.
    cgv                   = case
                              when p_payload ? 'cgv'
                              then nullif(btrim(p_payload->>'cgv'), '')
                              else cgv
                            end
  where id = v_id;

  return json_build_object('ok', true);
end
$function$;


-- La liste garde le PDF historique visible et distingue un envoi incertain.
create or replace function public.list_devis_by_token(p_token text)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.artisans;
begin
  a:=public._devis_artisan(p_token);
  if a.id is null then return '[]'::json; end if;
  if not (coalesce(a.contrat_externe,false) or exists(select 1 from public.contrats where artisan_id=a.id and statut='signe')) then return '[]'::json; end if;
  return (select coalesce(json_agg(json_build_object(
    'id',d.id,'numero',d.numero,'client_nom',d.client_nom,'objet',d.objet,'total',d.total,
    'statut',d.statut,'pdf_url',d.pdf_url,'date_devis',d.date_devis,'sent_at',d.sent_at,'projet_id',d.projet_id,
    'revision',d.revision,'envoi_etat',d.envoi_etat
  ) order by d.created_at desc),'[]'::json) from public.devis d where d.artisan_id=a.id);
end $$;
