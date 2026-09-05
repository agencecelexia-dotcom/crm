-- Le pont doit couvrir TOUT ce que l'artisan fait dans son espace.
--
-- CE QUI CLOCHAIT
--
-- 0126 n'aiguillait que trois actions — déclarer une étape, corriger,
-- abandonner. L'inventaire des fonctions du portail en compte dix. Les sept
-- autres n'avaient aucun chemin depuis son CRM :
--
--   * le MONTANT du devis (`set_montant_by_token`) — le chiffre sur lequel
--     repose la commission ;
--   * le DEVIS déposé (`set_devis_by_token`) ;
--   * le RAPPEL daté (`definir_rappel_by_token`) — le « je signe en rentrant
--     de vacances » ;
--   * l'APPEL loggué (`log_appel_by_token`) ;
--   * la RESTAURATION d'un chantier abandonné (`restaurer_chantier_by_token`) ;
--   * les messages de l'agence marqués LUS (`marquer_lu_by_token`).
--
-- Un pont qui n'en transmet qu'un tiers oblige l'artisan à revenir dans le
-- portail pour le reste — c'est-à-dire à faire exactement la double saisie
-- qu'on voulait supprimer.
--
-- LE PRINCIPE, INCHANGÉ
--
-- Aucune règle n'est recopiée : chaque type délègue à la fonction du portail
-- correspondante. Ce fichier n'est qu'un aiguillage.
--
-- CE QUI CHANGE DANS LA SIGNATURE
--
-- `p_montant_devis` / `p_montant_devis_signe` disparaissent au profit du
-- couple `p_montant` + `p_slot`, qui est la forme du portail (`devis` ou
-- `devis_signe`). Deux façons de dire la même chose valaient une divergence
-- de plus à maintenir. Personne n'étant encore branché, le changement ne
-- casse rien.

-- L'ancienne signature doit PARTIR, pas cohabiter : deux surcharges avec
-- valeurs par défaut rendent l'appel ambigu, et PostgREST choisirait au
-- hasard. C'est le piège que 0114 a dû défaire sur `retirer_chantier_by_token`.
drop function if exists public.pont_entrant(
  text, text, text, text, text, timestamptz, numeric, numeric, text);

create or replace function public.pont_entrant(
  p_token        text,
  p_evenement_id text,
  p_type         text,
  p_statut       text default null,
  p_message      text default null,
  p_date_rdv     timestamptz default null,
  -- Montant + emplacement : `devis` (le devis proposé) ou `devis_signe`
  -- (le montant réellement signé, base de la commission).
  p_montant      numeric default null,
  p_slot         text default null,
  p_url          text default null,
  p_quand        timestamptz default null,
  p_resultat     text default null,
  p_motif        text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  af public.affectations;
  v_deja jsonb;
  v_res json;
  v_slot text;
begin
  if coalesce(btrim(p_evenement_id), '') = '' then
    return json_build_object('ok', false, 'error', 'evenement_id_requis');
  end if;

  select * into af from public.affectations where token = p_token;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if not exists (
    select 1 from public.ponts_artisan
     where artisan_id = af.artisan_id and actif
  ) then
    return json_build_object('ok', false, 'error', 'pont_inactif');
  end if;

  -- IDEMPOTENCE. Son adaptateur réessaiera — c'est même exigé de lui. Rejouer
  -- l'écriture créerait un doublon de suivi ; on renvoie le résultat d'origine.
  --
  -- Deux appels VRAIMENT simultanés passeraient tous deux ce test : c'est la
  -- contrainte d'unicité qui tranche. Le perdant échoue en bloc et n'écrit
  -- donc rien ; son réessai retombera ici et lira le résultat du gagnant.
  select resultat into v_deja
    from public.pont_entrant
   where artisan_id = af.artisan_id and evenement_id = p_evenement_id;
  if found then
    return coalesce(v_deja::json, json_build_object('ok', true, 'rejoue', true));
  end if;

  -- RUPTURE D'ÉCHO, valable pour toute la transaction : les déclencheurs
  -- déclenchés par les appels ci-dessous ne réexpédieront rien VERS LUI. Les
  -- autres artisans du même chantier, eux, restent servis.
  perform set_config('celexia.pont_origine', af.artisan_id::text, true);

  -- ---------- Le montant, applicable avec n'importe quelle action ----------
  --
  -- Signer un devis, c'est déclarer une étape ET un montant. Exiger deux
  -- appels séparés multiplierait les allers-retours et les occasions qu'un
  -- des deux se perde — le montant serait alors absent d'une affaire signée.
  if p_montant is not null then
    -- Sans précision, le montant suit l'action : une signature porte le
    -- montant signé, tout le reste le montant du devis proposé.
    v_slot := coalesce(
      nullif(btrim(coalesce(p_slot, '')), ''),
      case when p_statut in ('devis_signe', 'termine') then 'devis_signe'
           else 'devis' end);

    if v_slot not in ('devis', 'devis_signe') then
      return json_build_object('ok', false, 'error', 'slot_invalide',
                               'slots_admis', array['devis', 'devis_signe']);
    end if;

    v_res := public.set_montant_by_token(p_token, v_slot, p_montant);
    if (v_res->>'ok')::boolean is not true then
      -- On journalise l'échec plutôt que de le laisser filer : c'est ce qui
      -- permet de répondre « ton montant a été refusé, voilà pourquoi ».
      insert into public.pont_entrant (artisan_id, evenement_id, type, charge, resultat)
      values (af.artisan_id, p_evenement_id, p_type,
              jsonb_build_object('montant', p_montant, 'slot', v_slot), v_res::jsonb);
      return v_res;
    end if;
  end if;

  -- ---------- Aiguillage ----------
  -- Chaque branche délègue. Aucune règle métier n'est recopiée ici.
  case p_type

    -- 'statut' et 'note' partagent le même chemin : c'est la présence d'un
    -- statut qui fait la différence, exactement comme dans le portail.
    when 'statut', 'note' then
      v_res := public.add_suivi_by_token(p_token, p_statut, p_message, p_date_rdv);

    when 'correction' then
      -- Corriger, c'est désigner l'étape à laquelle on revient. Sans elle,
      -- l'appel n'a rien à appliquer.
      if coalesce(btrim(p_statut), '') = '' then
        return json_build_object('ok', false, 'error', 'statut_requis');
      end if;
      v_res := public.corriger_etape_by_token(p_token, p_statut);

    when 'perdu' then
      -- Le motif appartient à une liste fermée (`origine_du_motif`, 0079). Le
      -- refuser ICI donne à l'artisan un message exploitable, là où la
      -- fonction du portail se contenterait d'un `motif_requis` muet.
      if public.origine_du_motif(p_motif) is null then
        return json_build_object(
          'ok', false, 'error', 'motif_invalide',
          'motifs_admis', array['hors_zone','doublon','hors_competence',
            'delai_incompatible','prix_trop_eleve','budget_insuffisant',
            'signe_concurrent','client_injoignable','client_renonce',
            'non_eligible_aides']);
      end if;
      -- Arguments NOMMÉS : la fonction prend la raison AVANT le motif (0079).
      -- Un appel positionnel les intervertirait, et le motif atterrirait dans
      -- la justification libre.
      v_res := public.retirer_chantier_by_token(
        p_token          := p_token,
        p_raison         := coalesce(btrim(p_message), ''),
        p_motif          := p_motif,
        p_recontacter_le := null::date);

    when 'restauration' then
      v_res := public.restaurer_chantier_by_token(p_token);

    -- Le montant a déjà été appliqué plus haut : il ne reste rien à faire.
    when 'montant' then
      if p_montant is null then
        return json_build_object('ok', false, 'error', 'montant_requis');
      end if;

    when 'devis' then
      if coalesce(btrim(p_url), '') = '' then
        return json_build_object('ok', false, 'error', 'url_requise');
      end if;
      v_res := public.set_devis_by_token(
        p_token, coalesce(nullif(btrim(coalesce(p_slot, '')), ''), 'devis'), p_url);

    when 'rappel' then
      -- `p_quand` nul est LÉGITIME : c'est ainsi qu'on annule un rappel.
      v_res := public.definir_rappel_by_token(p_token, p_quand);

    when 'appel' then
      if coalesce(p_resultat, 'pas_de_reponse') not in
         ('pas_de_reponse', 'repondu', 'rappeler', 'faux_numero') then
        return json_build_object(
          'ok', false, 'error', 'resultat_invalide',
          'resultats_admis', array['pas_de_reponse','repondu','rappeler','faux_numero']);
      end if;
      v_res := public.log_appel_by_token(
        p_token, coalesce(p_resultat, 'pas_de_reponse'), p_message);

    when 'lu' then
      v_res := public.marquer_lu_by_token(p_token);

    else
      return json_build_object(
        'ok', false, 'error', 'type_inconnu',
        'types_admis', array['statut','note','correction','perdu','restauration',
                             'montant','devis','rappel','appel','lu']);
  end case;

  insert into public.pont_entrant
    (artisan_id, evenement_id, type, charge, resultat)
  values (af.artisan_id, p_evenement_id, p_type,
          jsonb_build_object(
            'statut', p_statut, 'message', p_message, 'date_rdv', p_date_rdv,
            'montant', p_montant, 'slot', v_slot, 'url', p_url,
            'quand', p_quand, 'resultat', p_resultat, 'motif', p_motif),
          v_res::jsonb);

  return coalesce(v_res, json_build_object('ok', true));
end
$function$;

comment on function public.pont_entrant(text, text, text, text, text, timestamptz, numeric, text, text, timestamptz, text, text) is
  'Entrée unique du CRM partenaire. Couvre les DIX actions de l''espace '
  'artisan en déléguant aux fonctions du portail, et ajoute déduplication, '
  'rupture d''écho et journal. Authentifié par le jeton d''affectation.';

revoke execute on function public.pont_entrant(text, text, text, text, text, timestamptz, numeric, text, text, timestamptz, text, text) from public;
grant execute on function public.pont_entrant(text, text, text, text, text, timestamptz, numeric, text, text, timestamptz, text, text) to anon, authenticated;

-- ---------- Tester la connexion ----------
--
-- Sans ce bouton, la seule façon de savoir si le pont fonctionne était
-- d'attendre un vrai chantier. On envoie donc un événement `ping` qui ne
-- porte aucune donnée client et ne modifie rien : il traverse toute la
-- chaîne — file, signature, livraison, accusé — et prouve le tuyau.

create or replace function public.pont_tester(p_artisan_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_pont public.ponts_artisan;
  v_id bigint;
begin
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  select * into v_pont from public.ponts_artisan where artisan_id = p_artisan_id;
  if v_pont.artisan_id is null then
    return json_build_object('ok', false, 'error', 'pont_absent');
  end if;
  if not v_pont.actif then
    return json_build_object('ok', false, 'error', 'pont_inactif');
  end if;
  if coalesce(btrim(v_pont.url_webhook), '') = '' then
    return json_build_object('ok', false, 'error', 'url_absente');
  end if;

  -- On court-circuite `pont_enfiler` : un test doit partir même si
  -- l'interrupteur global est coupé, sinon on ne peut pas diagnostiquer.
  insert into public.pont_sortant (artisan_id, type, charge)
  values (p_artisan_id, 'ping', jsonb_build_object(
    'test', true,
    'message', 'Test de connexion Celexia. Réponds 2xx, ne crée aucune fiche.',
    'emis_le', now()
  ))
  returning id into v_id;

  -- Livraison immédiate : attendre le prochain battement du cron rendrait le
  -- bouton inutilisable.
  perform public.livrer_pont_sortant();

  return json_build_object('ok', true, 'evenement_id', v_id::text);
end
$function$;

comment on function public.pont_tester(uuid) is
  'Envoie un événement `ping` au CRM de l''artisan et le livre aussitôt. '
  'Ne porte aucune donnée client et ne modifie rien : sert à prouver le '
  'tuyau sans attendre un vrai chantier.';

revoke execute on function public.pont_tester(uuid) from public, anon;
grant execute on function public.pont_tester(uuid) to authenticated;

-- ---------- Lire le résultat du test ----------
--
-- `livrer_pont_sortant` rend la main avant que pg_net ait la réponse. L'écran
-- doit pouvoir demander « alors ? » une seconde plus tard.

create or replace function public.pont_etat_evenement(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v json;
begin
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  -- On relève les réponses au passage : sans cela, l'état resterait
  -- « envoyé » jusqu'au prochain battement du cron.
  perform public.reconcilier_pont_sortant();

  select json_build_object(
           'ok', true, 'etat', etat, 'code_http', code_http,
           'erreur', erreur, 'tentatives', tentatives)
    into v
    from public.pont_sortant where id = p_id;

  return coalesce(v, json_build_object('ok', false, 'error', 'introuvable'));
end
$function$;

revoke execute on function public.pont_etat_evenement(bigint) from public, anon;
grant execute on function public.pont_etat_evenement(bigint) to authenticated;
