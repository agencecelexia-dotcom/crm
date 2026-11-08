-- Réessai après réponse perdue : une intention produit au plus un suivi/appel.
-- Les signatures historiques restent disponibles pour les anciens onglets.
-- Les nouvelles surcharges n'ont AUCUN argument par défaut : PostgREST choisit
-- sans ambiguïté selon les noms de paramètres présents dans la requête.
-- Aucun texte client ni jeton ne sont recopiés dans le journal d'idempotence.
create table if not exists public.suivi_requetes_artisan (
  affectation_id uuid not null references public.affectations(id) on delete cascade,
  cle uuid not null,
  empreinte text not null check (length(empreinte) = 64),
  reponse jsonb not null,
  created_at timestamptz not null default now(),
  primary key (affectation_id, cle)
);
alter table public.suivi_requetes_artisan enable row level security;
revoke all on public.suivi_requetes_artisan from public, anon, authenticated;

-- Relire un accusé ne modifie pas un chantier : la dernière perte peut avoir
-- clos le projet dans la même transaction. L'identité et le contrat restent
-- exigés ; la garde d'écriture complète est appliquée aux nouvelles intentions.
create or replace function public.acces_accuse_suivi_par_jeton(p_token text)
returns text language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare af public.affectations; a public.artisans;
begin
  select * into af from public.affectations where token=p_token;
  if af.id is null then return 'token_invalide'; end if;
  select * into a from public.artisans where id=af.artisan_id;
  if a.id is null or a.ecarte_at is not null then return 'artisan_ecarte'; end if;
  if not exists(select 1 from public.projets where id=af.projet_id and deleted_at is null) then return 'projet_clos'; end if;
  if not coalesce(a.contrat_externe,false)
     and not coalesce((select c.statut='signe' from public.contrats c where c.artisan_id=a.id order by c.created_at asc limit 1),false) then
    return 'contrat_requis';
  end if;
  return null;
end
$function$;
revoke execute on function public.acces_accuse_suivi_par_jeton(text) from public, anon, authenticated;

create or replace function public.add_suivi_by_token(
  p_token text, p_statut text, p_message text, p_date_rdv timestamptz,
  p_cle uuid, p_motif text
)
returns json
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  af public.affectations;
  precedent public.suivi_requetes_artisan;
  v_erreur text;
  v_empreinte text;
  r json;
begin
  if p_cle is null then return json_build_object('ok', false, 'error', 'cle_requise'); end if;
  v_erreur := public.acces_accuse_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;
  -- Ordre commun aux nouvelles écritures : projet, puis affectation.
  -- La note et son accusé sont validés dans la même transaction PostgreSQL.
  select * into af from public.affectations where token=p_token;
  perform 1 from public.projets where id=af.projet_id for update;
  select * into af from public.affectations where token=p_token for update;
  if af.id is null then return json_build_object('ok', false, 'error', 'token_invalide'); end if;
  v_erreur := public.acces_accuse_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;
  v_empreinte := public.empreinte(jsonb_build_object(
    'action', 'suivi', 'statut', p_statut, 'message', p_message,
    'date_rdv', p_date_rdv at time zone 'UTC', 'motif', p_motif
  )::text);
  select * into precedent from public.suivi_requetes_artisan where affectation_id=af.id and cle=p_cle;
  if found then
    if precedent.empreinte <> v_empreinte then return json_build_object('ok', false, 'error', 'idempotence_conflit'); end if;
    return precedent.reponse::json;
  end if;
  v_erreur := public.acces_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;

  if p_statut = 'perdu' then
    if p_motif is null then return json_build_object('ok', false, 'error', 'motif_requis'); end if;
    if p_motif not in ('prix_trop_eleve','budget_insuffisant','signe_concurrent',
                      'client_injoignable','client_renonce','non_eligible_aides','autre') then
      return json_build_object('ok', false, 'error', 'motif_non_autorise');
    end if;
    if length(coalesce(btrim(p_message), '')) < 5 then
      return json_build_object('ok', false, 'error', 'justification_requise');
    end if;
  elsif p_motif is not null then
    return json_build_object('ok', false, 'error', 'motif_non_autorise');
  end if;

  -- Réutilise les règles déployées : garde financière, statut/étape/issue,
  -- historique et notifications. Une erreur annule aussi le reçu ci-dessous.
  r := public.add_suivi_by_token(p_token, p_statut, p_message, p_date_rdv);
  if coalesce((r->>'ok')::boolean, false) is not true then return r; end if;
  if p_statut = 'perdu' then
    update public.affectations
       set motif_perte=p_motif, motif_perte_detail=btrim(p_message),
           origine_perte='client', recontacter_le=null
     where id=af.id;
    -- Le retrait artisan reste le parcours distinct retirer_chantier_by_token.
    -- Aucun retire_at n'est posé ici et les anciennes pertes ne sont pas requalifiées.
  end if;
  insert into public.suivi_requetes_artisan(affectation_id,cle,empreinte,reponse)
    values(af.id,p_cle,v_empreinte,r::jsonb);
  return r;
end
$function$;
revoke execute on function public.add_suivi_by_token(text,text,text,timestamptz,uuid,text) from public;
grant execute on function public.add_suivi_by_token(text,text,text,timestamptz,uuid,text) to anon, authenticated;

create or replace function public.log_appel_by_token(
  p_token text, p_resultat text, p_message text, p_cle uuid
)
returns json
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  af public.affectations;
  precedent public.suivi_requetes_artisan;
  v_erreur text;
  v_empreinte text;
  r json;
begin
  if p_cle is null then return json_build_object('ok', false, 'error', 'cle_requise'); end if;
  v_erreur := public.acces_accuse_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;
  select * into af from public.affectations where token=p_token;
  perform 1 from public.projets where id=af.projet_id for update;
  select * into af from public.affectations where token=p_token for update;
  if af.id is null then return json_build_object('ok', false, 'error', 'token_invalide'); end if;
  v_erreur := public.acces_accuse_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;
  v_empreinte := public.empreinte(jsonb_build_object(
    'action','appel','resultat',p_resultat,'message',p_message
  )::text);
  select * into precedent from public.suivi_requetes_artisan where affectation_id=af.id and cle=p_cle;
  if found then
    if precedent.empreinte <> v_empreinte then return json_build_object('ok', false, 'error', 'idempotence_conflit'); end if;
    return precedent.reponse::json;
  end if;
  v_erreur := public.acces_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;
  r := public.log_appel_by_token(p_token, p_resultat, p_message);
  if coalesce((r->>'ok')::boolean, false) is not true then return r; end if;
  insert into public.suivi_requetes_artisan(affectation_id,cle,empreinte,reponse)
    values(af.id,p_cle,v_empreinte,r::jsonb);
  return r;
end
$function$;
revoke execute on function public.log_appel_by_token(text,text,text,uuid) from public;
grant execute on function public.log_appel_by_token(text,text,text,uuid) to anon, authenticated;
