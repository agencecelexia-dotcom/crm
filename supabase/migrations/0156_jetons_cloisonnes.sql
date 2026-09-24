-- Ce qu'un jeton ouvre, et ce qu'il n'ouvre plus.
--
-- Trouvé par l'audit sécurité, prouvé en transaction annulée :
--
-- 1. UN ARTISAN ÉCARTÉ GARDAIT TOUT. Le bouton « Écarter » ne pose qu'une date,
--    et les fonctions historiques par jeton ne la lisaient pas : espace,
--    coordonnées des clients, suivis, montants — tout restait ouvert.
--
-- 2. UNE AFFECTATION RETIRÉE ÉCRIVAIT ENCORE. L'artisan qui a perdu un chantier
--    au profit d'un confrère pouvait réécrire la fiche client — et l'EFFACER :
--    `update_projet_by_token` traduisait une chaîne vide en NULL. Il pouvait
--    aussi passer son affectation en « devis signé » (faussant les KPI) et
--    saisir un montant de 99 999 €.
--
-- 3. `metre_contexte_by_token` renvoyait les métrés de TOUS les artisans du
--    chantier, alors que la multi-attribution est annoncée comme cloisonnée.
--
-- Un garde-fou central, `acces_par_jeton`, se pose en tête de chaque fonction.
-- En lecture il ne vérifie que l'artisan écarté ; en écriture, aussi le
-- chantier retiré. `restaurer_chantier_by_token` garde son droit d'agir sur un
-- chantier retiré : c'est son objet, et elle a ses propres garde-fous.
--
-- `update_projet_by_token` n'efface plus un champ du client à partir d'une
-- chaîne vide : il le laisse tel quel.

create or replace function public.acces_par_jeton(p_token text, p_ecriture boolean default true)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  af public.affectations;
  v_ecarte timestamptz;
begin
  -- Jeton d'affectation (un chantier) ?
  select * into af from public.affectations where token = p_token;
  if af.id is not null then
    select ecarte_at into v_ecarte from public.artisans where id = af.artisan_id;
    if v_ecarte is not null then return 'artisan_ecarte'; end if;
    if p_ecriture and af.retire_at is not null then return 'chantier_retire'; end if;
    return null;
  end if;
  -- Jeton d'artisan (tout son espace) ?
  select ecarte_at into v_ecarte from public.artisans where token = p_token;
  if found and v_ecarte is not null then return 'artisan_ecarte'; end if;
  -- Jeton inconnu : chaque fonction garde sa propre réponse.
  return null;
end
$function$;

-- Appelée depuis des fonctions SECURITY DEFINER seulement.
revoke execute on function public.acces_par_jeton(text, boolean) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.corriger_etape_by_token(p_token text, p_etape text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, true));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if p_etape is not null and p_etape not in
     ('contacte','rdv_pris','devis_envoye','devis_signe','termine') then
    return json_build_object('ok', false, 'error', 'etape_invalide');
  end if;

  -- Garde-fou : on ne rétrograde pas un dossier dont le devis signé est déposé.
  if af.devis_signe_url is not null
     and public.rang_etape(p_etape) < public.rang_etape('devis_signe') then
    return json_build_object('ok', false, 'error', 'devis_signe_depose');
  end if;

  update public.affectations
     set etape = p_etape,
         issue = case when p_etape in ('devis_signe','termine') then 'gagne'
                      when issue = 'gagne' then 'en_cours' else issue end
   where id = af.id;

  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'artisan', 'note',
          'Étape corrigée manuellement : ' || coalesce(p_etape, 'aucune'));

  return json_build_object('ok', true, 'etape', p_etape);
end;
$function$;

CREATE OR REPLACE FUNCTION public.definir_rappel_by_token(p_token text, p_quand timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, true));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if p_quand is not null and p_quand < now() - interval '1 day' then
    return json_build_object('ok', false, 'error', 'date_passee');
  end if;

  update public.affectations set rappel_le = p_quand where id = af.id;

  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'artisan', 'note',
          case when p_quand is null then 'Rappel annulé'
               else 'Rappel programmé le ' ||
                    to_char(p_quand at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI') end);

  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_appel_by_token(p_token text, p_resultat text DEFAULT 'pas_de_reponse'::text, p_message text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; v_txt text;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, true));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  v_txt := case p_resultat
    when 'pas_de_reponse' then '📞 Appel — pas de réponse'
    when 'repondu'        then '📞 Appel — client joint'
    when 'rappeler'       then '📞 Appel — à rappeler plus tard'
    when 'faux_numero'    then '📞 Appel — numéro injoignable / invalide'
    else '📞 Appel' end;
  if coalesce(btrim(p_message), '') <> '' then
    v_txt := v_txt || ' — ' || btrim(p_message);
  end if;
  insert into public.suivis (projet_id, affectation_id, auteur, type, message, resultat_appel)
  values (af.projet_id, af.id, 'artisan', 'appel', v_txt, p_resultat);
  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_devis_by_token(p_token text, p_slot text, p_url text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, true));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if p_slot = 'devis' then
    update public.affectations set devis_url = p_url where id = af.id;
  elsif p_slot = 'devis_signe' then
    update public.affectations set devis_signe_url = p_url where id = af.id;
  else
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_montant_by_token(p_token text, p_slot text, p_montant numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, true));
  end if;
  if p_montant is null or p_montant < 0 or p_montant > 10000000 then
    return json_build_object('ok', false, 'error', 'montant_invalide');
  end if;

  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if p_slot = 'devis' then
    update public.affectations set montant_devis = p_montant where id = af.id;
  elsif p_slot = 'devis_signe' then
    update public.affectations set montant_devis_signe = p_montant where id = af.id;
  else
    return json_build_object('ok', false, 'error', 'slot_invalide');
  end if;

  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.creer_devis_by_token(p_token text, p_payload jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.artisans;
  af public.affectations;
  v_num text;
  v_id uuid;
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_payload->>'affectation_token', true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_payload->>'affectation_token', true));
  end if;
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false, 'error', 'non autorisé'); end if;

  -- Le chiffrage s'ouvre avec les assurances (0131), et se referme tout seul
  -- quand elles expirent. Contrôlé ici, pas seulement à l'écran : un appel
  -- direct à l'API doit être refusé de la même façon.
  if not public.peut_chiffrer(a.id) then
    return json_build_object('ok', false, 'error', 'chiffrage_non_active');
  end if;

  if coalesce(p_payload->>'affectation_token','') <> '' then
    select * into af from public.affectations
     where token = p_payload->>'affectation_token' and artisan_id = a.id;
  end if;

  if af.id is null then
    select af3.* into af
      from public.affectations af3
      join public.projets p3 on p3.id = af3.projet_id
     where af3.artisan_id = a.id
       and af3.statut <> 'perdu'
       and p3.deleted_at is null
       and (
         (nullif(regexp_replace(coalesce(p_payload->>'client_tel',''), '\D', '', 'g'), '') is not null
           and regexp_replace(coalesce(p3.client_telephone,''), '\D', '', 'g')
               = regexp_replace(p_payload->>'client_tel', '\D', '', 'g'))
         or (nullif(trim(p_payload->>'client_nom'), '') is not null
           and lower(trim(p3.client_nom)) = lower(trim(p_payload->>'client_nom')))
       )
     order by af3.created_at desc
     limit 1;
  end if;

  v_num := 'DEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.devis_seq')::text, 4, '0');

  -- Les totaux sont recalculés ici plutôt que crus sur parole : le client
  -- pourrait envoyer n'importe quoi, et c'est ce chiffre qui porte la
  -- commission.
  select
    coalesce(sum((l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric), 0),
    coalesce(sum((l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric
                 * coalesce((l->>'tva_taux')::numeric, 0) / 100), 0)
    into v_ht, v_tva
    from jsonb_array_elements(coalesce(p_payload->'lignes','[]'::jsonb)) l;
  v_ttc := round(v_ht + v_tva, 2);

  insert into public.devis (
    artisan_id, projet_id, affectation_id, numero,
    client_nom, client_adresse, client_cp, client_ville, client_email, client_tel,
    objet, lignes, total, total_ht, total_tva, tva_mode,
    acompte_pct, conditions, notes, date_validite
  ) values (
    a.id, af.projet_id, af.id, v_num,
    p_payload->>'client_nom', p_payload->>'client_adresse', p_payload->>'client_cp',
    p_payload->>'client_ville', p_payload->>'client_email', p_payload->>'client_tel',
    p_payload->>'objet', coalesce(p_payload->'lignes','[]'::jsonb),
    v_ttc, round(v_ht, 2), round(v_tva, 2),
    nullif(p_payload->>'tva_mode',''),
    nullif(p_payload->>'acompte_pct','')::numeric,
    p_payload->>'conditions', p_payload->>'notes',
    nullif(p_payload->>'date_validite','')::date
  ) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'numero', v_num,
                           'projet_id', af.projet_id,
                           'total_ht', round(v_ht, 2), 'total_ttc', v_ttc);
end
$function$;

CREATE OR REPLACE FUNCTION public.marquer_lu_by_token(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; n int;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, false));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  update public.suivis
     set lu_at = now()
   where affectation_id = af.id and auteur = 'agence' and lu_at is null;
  get diagnostics n = row_count;

  return json_build_object('ok', true, 'marques', n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.retirer_chantier_by_token(p_token text, p_raison text, p_motif text, p_recontacter_le date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; v_garde json; v_restants int;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, false));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if af.retire_at is not null then return json_build_object('ok', true, 'deja_retire', true); end if;

  if length(coalesce(btrim(p_raison), '')) < 5 then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;
  if p_motif is null then
    return json_build_object('ok', false, 'error', 'motif_requis');
  end if;

  v_garde := public.peut_abandonner_affectation(af.id);
  if (v_garde->>'ok')::boolean is false then
    return json_build_object('ok', false, 'error', v_garde->>'raison');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'retrait', 'perdu', btrim(p_raison));

  update public.affectations
     set statut = 'perdu', retire_at = now(), issue = 'perdu',
         motif_perte = p_motif,
         motif_perte_detail = btrim(p_raison),
         origine_perte = public.origine_du_motif(p_motif),
         recontacter_le = p_recontacter_le
   where id = af.id;

  select count(*) into v_restants
    from public.affectations af2
   where af2.projet_id = af.projet_id and af2.issue <> 'perdu' and af2.retire_at is null;

  if v_restants = 0 then
    update public.projets
       set statut = 'nouveau', artisan_id = null,
           montant_devis_signe = null, montant_devis = null
     where id = af.projet_id and statut <> 'mort';

    insert into public.notifications (type, titre, message, projet_id)
    values ('a_reassigner',
      'À réassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
      'Motif : ' || p_motif || ' — ' || btrim(p_raison), af.projet_id);
  end if;

  insert into public.notifications (type, titre, message, projet_id)
  values ('artisan_retrait',
    'Retrait artisan : ' || coalesce(
      (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'artisan'),
    p_motif || ' — ' || btrim(p_raison), af.projet_id);

  -- Notification par e-mail : un chantier perdu par l'artisan principal doit
  -- être repris vite. La cloche dans le CRM ne suffit pas — il faut le savoir
  -- même quand personne n'a l'application ouverte.
  --
  -- `net.http_post` est asynchrone : si n8n est indisponible, le retrait est
  -- déjà enregistré et n'est pas annulé pour autant.
  perform net.http_post(
    url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
    body := jsonb_build_object(
      'event', 'chantier_perdu',
      'artisan', (select coalesce(a.societe, a.nom) from public.artisans a
                   where a.id = af.artisan_id),
      'client_nom',   (select client_nom   from public.projets where id = af.projet_id),
      'client_ville', (select client_ville from public.projets where id = af.projet_id),
      'metier',       (select metier       from public.projets where id = af.projet_id),
      'montant',      af.montant_devis,
      'motif',        p_motif,
      'raison',       btrim(p_raison),
      'recontacter_le', p_recontacter_le,
      -- Zéro artisan restant : le chantier est orphelin, c'est le cas urgent.
      'orphelin',     (v_restants = 0),
      'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
    )
  );

  return json_build_object('ok', true, 'restants', v_restants);
end;
$function$;

CREATE OR REPLACE FUNCTION public.restaurer_chantier_by_token(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  af public.affectations;
  p  public.projets;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, false));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  select * into p from public.projets where id = af.projet_id;

  -- Un projet mort ou supprimé ne se récupère pas : décision d'agence.
  if p.id is null or p.deleted_at is not null or p.statut = 'mort' then
    return json_build_object('ok', false, 'error', 'projet_clos');
  end if;

  -- Ni un chantier déjà repris par un CONFRÈRE.
  if p.artisan_id is not null and p.artisan_id <> af.artisan_id then
    return json_build_object('ok', false, 'error', 'deja_attribue');
  end if;

  update public.affectations
     set statut     = 'artisan_assigne',
         retire_at  = null,
         perdu_at   = null,
         masque_at  = null
   where id = af.id;

  -- Le projet ne redevient actif que s'il n'a pas déjà avancé avec quelqu'un.
  update public.projets
     set statut = 'artisan_assigne'
   where id = af.projet_id
     and statut in ('nouveau', 'a_rappeler', 'perdu');

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'note', null,
          'Chantier remis dans le pipe par l''artisan (client recontacté).');

  insert into public.notifications (type, titre, message, projet_id)
  values ('chantier_restaure',
    'Chantier repris : ' || coalesce(p.client_nom, 'chantier'),
    coalesce((select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'Un artisan')
      || ' a remis ce chantier dans son pipe.',
    af.projet_id);

  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_suivi_by_token(p_token text, p_statut text DEFAULT NULL::text, p_message text DEFAULT NULL::text, p_date_rdv timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  af public.affectations;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, false));
  end if;
  select * into af from public.affectations where token = p_token and retire_at is null;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false, 'error', 'rien_a_enregistrer');
  end if;

  -- Statuts déclarables par l'ARTISAN. « mort » est réservé à l'agence :
  -- l'artisan ne décide pas qu'un lead est définitivement perdu pour tous.
  if coalesce(p_statut, '') <> '' and p_statut not in
     ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'devis_signe', 'termine', 'perdu') then
    return json_build_object('ok', false, 'error', 'statut_non_autorise');
  end if;

  -- Un abandon doit être motivé : sans justification, le lead n'est pas
  -- exploitable pour comprendre pourquoi il a échoué.
  if p_statut = 'perdu' and coalesce(btrim(p_message), '') = '' then
    return json_build_object('ok', false, 'error', 'motif_requis');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  -- « En attente » est un DRAPEAU, pas une étape : il marque une pause sans
  -- effacer l'avancement. Un chantier dont le devis est parti reste « devis
  -- envoyé » même si l'artisan le met en pause — sinon on perd l'information
  -- la plus utile du dossier.
  if p_statut = 'en_attente' then
    update public.affectations
       set en_attente_depuis = coalesce(en_attente_depuis, now())
     where id = af.id;

    return json_build_object('ok', true, 'sous_statut', 'en_attente');
  end if;

  if coalesce(p_statut, '') <> '' then
    update public.affectations
      set statut = p_statut,
          -- Toute étape déclarée lève la pause : l'artisan a repris la main.
          en_attente_depuis = null,
          date_rdv = case when p_statut = 'rdv_pris' and p_date_rdv is not null
                          then p_date_rdv else date_rdv end,
          -- Horodate la perte (compte à rebours des 15 jours) ; repartir sur un
          -- autre statut remet le chantier dans le pipe.
          perdu_at = case when p_statut = 'perdu' then coalesce(perdu_at, now()) else null end
      where id = af.id;
    select * into af from public.affectations where id = af.id;

    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'changement_statut',
        'statut', p_statut,
        'artisan', (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
        'client_nom', (select p.client_nom from public.projets p where p.id = af.projet_id),
        'client_ville', (select p.client_ville from public.projets p where p.id = af.projet_id),
        'metier', (select p.metier from public.projets p where p.id = af.projet_id),
        'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
      )
    );
  end if;

  if p_statut = 'devis_signe' then
    -- Un devis signé par un artisan ne fait pas disparaître le chantier pour
    -- les autres : on note simplement le gagnant au niveau du projet.
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;

  elsif p_statut in ('contacte', 'rdv_pris', 'devis_envoye', 'termine', 'perdu') then
    if exists (select 1 from public.affectations af2
                where af2.projet_id = af.projet_id and af2.statut <> 'perdu'
                  and af2.retire_at is null) then
      -- Au moins un artisan encore actif : le projet prend le meilleur statut actif.
      update public.projets p set statut = (
        select af2.statut from public.affectations af2
         where af2.projet_id = p.id and af2.statut <> 'perdu' and af2.retire_at is null
         order by case af2.statut
                    when 'termine' then 6 when 'devis_signe' then 5
                    when 'devis_envoye' then 4 when 'rdv_pris' then 3
                    when 'contacte' then 2 else 1 end desc
         limit 1)
      where p.id = af.projet_id and p.statut not in ('mort', 'devis_signe', 'termine');
    else
      -- Plus aucun artisan actif : le chantier retourne dans le pipe agence
      -- (statut 'nouveau', détaché de l'artisan). Un projet déjà déclaré
      -- mort le reste.
      update public.projets set statut = 'nouveau', artisan_id = null
       where id = af.projet_id and statut <> 'mort';
    end if;
  end if;

  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_espace_artisan(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    -- Même réponse qu'un jeton inconnu : l'écran affiche « lien invalide »
    -- au lieu de tenter de dessiner un espace à partir d'un message d'erreur.
    return null;
  end if;
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  c := public.ensure_engagement_contrat(a.id);
  v_signe := (c.statut = 'signe') or a.contrat_externe;

  return json_build_object(
    'artisan', json_build_object(
      'id', a.id, 'nom', a.nom, 'prenom', a.prenom, 'societe', a.societe,
      'adresse', a.adresse, 'code_postal', a.code_postal, 'ville', a.ville,
      'siren', a.siren, 'forme_juridique', a.forme_juridique,
      'telephone', a.telephone, 'email', a.email, 'representant', a.representant
    ),
    'engagement', json_build_object(
      'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
      'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
      'signature_data', c.signature_data, 'apporteur_signature', c.apporteur_signature
    ),
    'signe', v_signe,
    'contrat_externe', a.contrat_externe,

    -- Statistiques calculées sur la TOTALITÉ des affectations de l'artisan,
    -- y compris celles masquées ou sorties du pipe : nettoyer sa liste ne
    -- doit jamais fausser ses chiffres.
    -- KPI calculés sur les FAITS (étape atteinte, issue, montants) et non
    -- plus sur `statut`, qui était écrasable. Voir 0075/0076.
    'stats', public.stats_artisan_faits(a.id),

    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          case af.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            -- Deux axes séparés : l'étape ne recule plus, l'attente
            -- est un drapeau daté et non plus un statut qui écrase.
            'etape', af.etape, 'issue', af.issue,
            'en_attente_depuis', af.en_attente_depuis,
            'rappel_le', af.rappel_le,
            'recu_le', p.created_at,
            'derniere_activite', af.updated_at,
            'date_rdv', af.date_rdv,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis, 'montant_devis_signe', af.montant_devis_signe,
            'commission', case when p.artisan_id = af.artisan_id then p.commission end,
            'commission_encaissee',
              case when p.artisan_id = af.artisan_id then p.commission_encaissee else false end,
            'client_ville', p.client_ville, 'photos', coalesce(p.photos, '{}'),
            'devis_depose', af.devis_url is not null,
            'devis_signe_depose', af.devis_signe_url is not null,
            -- URLs des PDF déposés : l'artisan doit pouvoir RELIRE ce qu'il a
            -- envoyé, pas seulement savoir qu'un fichier existe.
            'devis_url', af.devis_url,
            'devis_signe_url', af.devis_signe_url,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'non_lus', (select count(*) from public.suivis s2
                        where s2.affectation_id = af.id
                          and s2.auteur = 'agence' and s2.lu_at is null),
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                -- Le fil devient bidirectionnel : l'artisan distingue enfin
                -- une consigne de l'agence de sa propre saisie (0080).
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            )
          ) as p_json
        from public.affectations af
        join public.projets p on p.id = af.projet_id
        where af.artisan_id = a.id
          and p.deleted_at is null
          and af.retire_at is null          -- ← 0061 : retrait volontaire de l'artisan
          -- Pipe nettoyé : masqués par l'agence, perdus depuis plus de 15
          -- jours, et projets déclarés morts sortent de la liste.
          and af.masque_at is null
          and p.statut <> 'mort'
          and not (af.statut = 'perdu' and coalesce(af.perdu_at, af.updated_at) < now() - interval '15 days')
      ) sub
    ),

    -- Espace « Perdus » : tout ce qui est sorti du pipe ci-dessus, à
    -- l'exception des projets déclarés morts par l'agence — inutile de
    -- proposer à l'artisan de récupérer un lead parti chez un concurrent.
    -- `restaurable` indique s'il peut le remettre dans son pipe lui-même.
    'projets_perdus', (
      select coalesce(json_agg(p_json order by sorti_le desc), '[]'::json)
      from (
        select
          coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis,
            'client_ville', p.client_ville,
            'sorti_le', coalesce(af.retire_at, af.perdu_at, af.updated_at),
            'motif', case
                       when af.retire_at is not null then 'retrait'
                       when af.statut = 'perdu'      then 'perdu'
                       else 'masque' end,
            -- Un chantier repris par un autre artisan n'est plus récupérable.
            'restaurable', (p.statut <> 'mort' and p.deleted_at is null
                            and (p.artisan_id is null or p.artisan_id = af.artisan_id)),
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_code_postal', p.client_code_postal,
            'motif_perte', af.motif_perte,
            -- Ce qui manquait pour décider d'une réattribution : l'HISTORIQUE.
            -- Le résumé d'une ligne ne dit pas si l'artisan a chiffré, à quel
            -- prix, ni pourquoi le client a dit non. Sans ces éléments, on
            -- réattribue à l'aveugle — ou on n'ose pas réattribuer du tout.
            'recu_le', coalesce(af.created_at, p.created_at),
            'etape', af.etape,
            'date_rdv', af.date_rdv,
            'montant_devis_signe', af.montant_devis_signe,
            'devis_url', af.devis_url,
            'devis_signe_url', af.devis_signe_url,
            'devis_depose', af.devis_url is not null,
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            ),
            'derniere_raison', (
              select s.message from public.suivis s
               where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
               order by s.created_at desc limit 1
            )
          ) as p_json
        from public.affectations af
        join public.projets p on p.id = af.projet_id
        where af.artisan_id = a.id
          and p.deleted_at is null
          and p.statut <> 'mort'
          and (
            af.retire_at is not null
            or af.masque_at is not null
            or (af.statut = 'perdu'
                and coalesce(af.perdu_at, af.updated_at) < now() - interval '15 days')
          )
      ) sub
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.releve_commissions_by_token(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.artisans;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    -- Même réponse qu'un jeton inconnu : l'écran affiche « lien invalide »
    -- au lieu de tenter de dessiner un espace à partir d'un message d'erreur.
    return null;
  end if;
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  return json_build_object(
    'taux_contractuel', a.taux_commission,
    'lignes', (
      select coalesce(json_agg(json_build_object(
        'projet_id', p.id,
        'client', p.client_nom,
        'ville', p.client_ville,
        'metier', p.metier,
        -- Assiette : le montant sur lequel la commission est calculée.
        'assiette', p.montant_devis_signe,
        'taux', p.taux_commission,
        'commission', p.commission,
        'reglee', p.commission_encaissee,
        'date_signature', p.date_signature,
        'devis_url', af.devis_signe_url
      ) order by p.date_signature desc nulls last, p.created_at desc), '[]'::json)
      from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id
        and p.deleted_at is null
        and p.artisan_id = a.id
        and af.issue = 'gagne'
        and p.commission is not null
        and p.commission > 0
    ),
    'total_du', (
      select coalesce(sum(p.commission), 0)
      from public.affectations af join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id and p.artisan_id = a.id and p.deleted_at is null
        and af.issue = 'gagne' and not p.commission_encaissee),
    'total_regle', (
      select coalesce(sum(p.commission), 0)
      from public.affectations af join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id and p.artisan_id = a.id and p.deleted_at is null
        and p.commission_encaissee)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_projet_by_token(p_token text, p_client_nom text, p_client_email text, p_client_adresse text, p_client_code_postal text, p_client_ville text, p_description text, p_budget numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès; une affectation
  -- retirée ne peut plus rien écrire sur le chantier — qui peut être tenu par un confrère.
  if public.acces_par_jeton(p_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_token, true));
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;

  update public.projets set
    client_nom = coalesce(nullif(p_client_nom, ''), client_nom),
    client_email = coalesce(nullif(btrim(p_client_email), ''), client_email),
    client_adresse = coalesce(nullif(btrim(p_client_adresse), ''), client_adresse),
    client_code_postal = coalesce(nullif(btrim(p_client_code_postal), ''), client_code_postal),
    client_ville = coalesce(nullif(btrim(p_client_ville), ''), client_ville),
    description = coalesce(nullif(btrim(p_description), ''), description),
    budget_estime = p_budget
  where id = af.projet_id;

  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.metre_contexte_by_token(p_token text, p_affectation_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_artisan uuid;
  af public.affectations;
  p  public.projets;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if p_affectation_token is not null then
    select * into af from public.affectations where token = p_affectation_token;
    if af.id is null or af.artisan_id <> v_artisan then
      return json_build_object('ok', false, 'error', 'chantier_introuvable');
    end if;
    select * into p from public.projets where id = af.projet_id;
  end if;

  return json_build_object(
    'ok', true,
    'projet_id', p.id,
    'affectation_id', af.id,
    'client_ville', p.client_ville,
    'client_adresse', case when p.id is not null
       and exists (select 1 from public.contrats c
                    where c.artisan_id = v_artisan and c.signed_at is not null)
      then p.client_adresse end,
    'client_code_postal', p.client_code_postal,
    'latitude', p.latitude,
    'longitude', p.longitude,
    'metier', p.metier,
    'metres', (
      select coalesce(json_agg(json_build_object(
               'id', m.id, 'nom', m.nom, 'type', m.type, 'geometrie', m.geometrie,
               'surface_m2', m.surface_m2, 'perimetre_m', m.perimetre_m,
               'longueur_m', m.longueur_m, 'hauteur_m', m.hauteur_m,
               'pente_pct', m.pente_pct, 'surface_reelle_m2', m.surface_reelle_m2,
               'ouvertures_m2', m.ouvertures_m2, 'azimut', m.azimut,
               'pente_source', m.pente_source, 'hauteur_source', m.hauteur_source,
               'source', m.source, 'created_at', m.created_at)
             order by m.created_at desc), '[]'::json)
        from public.metres m where m.projet_id = p.id and m.artisan_id = v_artisan)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.documents_projet_par_token(p_token text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    json_agg(
      json_build_object(
        'id', d.id,
        'nom', d.nom,
        'type_mime', d.type_mime,
        'taille_octets', d.taille_octets,
        'created_at', d.created_at
      ) order by d.created_at desc
    ),
    '[]'::json
  )
  from public.affectations af
  join public.projets p         on p.id = af.projet_id
  join public.projet_documents d on d.projet_id = p.id
  where af.token = p_token
    and af.retire_at is null
    and not exists (select 1 from public.artisans x where x.id = af.artisan_id and x.ecarte_at is not null)
    and p.deleted_at is null
    and d.visible_artisan;
$function$;

CREATE OR REPLACE FUNCTION public.token_affectation_valide(p_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.affectations a
     where a.token = p_token
       and a.retire_at is null
       and not exists (select 1 from public.artisans x where x.id = a.artisan_id and x.ecarte_at is not null)
  );
$function$;
