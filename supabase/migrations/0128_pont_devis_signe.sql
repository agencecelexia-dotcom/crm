-- Le dépôt d'un devis SIGNÉ doit échouer bruyamment, ou pas du tout.
--
-- CE QUI CLOCHAIT
--
-- 0127 aiguille bien le type `devis` vers `set_devis_by_token`, qui accepte
-- les deux emplacements — `devis` (le devis proposé) et `devis_signe` (celui
-- que le client a retourné signé). Mais l'emplacement n'était VALIDÉ que
-- lorsqu'un montant accompagnait l'appel.
--
-- Conséquence : un artisan qui écrit `p_slot: "signe"` au lieu de
-- `"devis_signe"` reçoit `{"ok": false}` — sans champ `error`, sans liste des
-- valeurs admises, sans rien. C'est le pire retour possible : il croit à une
-- panne de notre côté et cherche là où il n'y a rien.
--
-- LE PIÈGE, PLUS GRAVE
--
-- `trg_coherence_issue` (0120/0121) détache le devis signé tant que le STATUT
-- déclaré n'atteint pas `devis_signe` : « une affaire ne peut être gagnée que
-- si le statut atteint la signature ». Déposer le PDF ne suffit donc pas — le
-- lien est effacé dans la foulée, et l'appel renvoie pourtant `ok`.
--
-- Vérifié en production : les 4 affectations portant un devis signé ont toutes
-- un statut `devis_signe`, aucune incohérente. Le garde-fou fait son travail.
--
-- Dans le portail, l'artisan clique l'étape puis dépose. Par le pont, rien ne
-- l'y oblige — et son document le plus important disparaîtrait en silence.
-- On rétablit donc l'ordre nous-mêmes : déposer un devis SIGNÉ, c'est déclarer
-- que l'affaire est signée. Le dire dans la notice ne suffirait pas ; l'erreur
-- serait invisible jusqu'à la facturation.

create or replace function public.pont_entrant(
  p_token        text,
  p_evenement_id text,
  p_type         text,
  p_statut       text default null,
  p_message      text default null,
  p_date_rdv     timestamptz default null,
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

  -- Refus commun aux deux branches qui manipulent un emplacement. Écrit une
  -- fois : deux formulations divergentes du même refus finiraient par ne plus
  -- dire la même chose.
  c_slots constant text[] := array['devis', 'devis_signe'];
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

  -- ---------- L'emplacement, résolu une fois pour toutes ----------
  --
  -- Déduction : une signature porte le montant signé, tout le reste le montant
  -- du devis proposé. Un type `devis` sans précision dépose le devis proposé —
  -- déposer un signé se dit explicitement, c'est un acte qui engage la
  -- commission.
  v_slot := coalesce(
    nullif(btrim(coalesce(p_slot, '')), ''),
    case when p_statut in ('devis_signe', 'termine') then 'devis_signe'
         else 'devis' end);

  if (p_montant is not null or p_type = 'devis') and not (v_slot = any (c_slots)) then
    return json_build_object('ok', false, 'error', 'slot_invalide',
                             'slots_admis', c_slots);
  end if;

  -- ---------- Signer avant de déposer ----------
  --
  -- Le garde-fou 0120/0121 efface un devis signé porté par un chantier dont le
  -- statut n'a pas atteint la signature. Un `montant` ou un `devis` déposé sur
  -- l'emplacement `devis_signe` DIT que l'affaire est signée : on déclare
  -- l'étape d'abord, sinon le dépôt part au néant sans que personne le voie.
  --
  -- Sans effet si l'appel portait déjà le statut (`p_statut: devis_signe`) ou
  -- si le chantier y est déjà : `add_suivi_by_token` est monotone.
  if v_slot = 'devis_signe'
     and p_type in ('montant', 'devis')
     and public.rang_statut(coalesce(af.statut, '')) < public.rang_statut('devis_signe')
  then
    perform public.add_suivi_by_token(
      p_token, 'devis_signe',
      coalesce(nullif(btrim(coalesce(p_message, '')), ''),
               'Devis signé transmis depuis le CRM de l''artisan'),
      null);
    -- L'affectation a changé sous nos pieds : la relire évite de raisonner
    -- ensuite sur un statut périmé.
    select * into af from public.affectations where token = p_token;
  end if;

  -- ---------- Le montant, applicable avec n'importe quelle action ----------
  --
  -- Signer un devis, c'est déclarer une étape ET un montant. Exiger deux
  -- appels séparés multiplierait les allers-retours et les occasions qu'un
  -- des deux se perde — le montant serait alors absent d'une affaire signée.
  if p_montant is not null then
    v_res := public.set_montant_by_token(p_token, v_slot, p_montant);
    if (v_res->>'ok')::boolean is not true then
      insert into public.pont_entrant (artisan_id, evenement_id, type, charge, resultat)
      values (af.artisan_id, p_evenement_id, p_type,
              jsonb_build_object('montant', p_montant, 'slot', v_slot), v_res::jsonb);
      return v_res;
    end if;
  end if;

  -- ---------- Aiguillage ----------
  -- Chaque branche délègue. Aucune règle métier n'est recopiée ici.
  case p_type

    when 'statut', 'note' then
      v_res := public.add_suivi_by_token(p_token, p_statut, p_message, p_date_rdv);

    when 'correction' then
      if coalesce(btrim(p_statut), '') = '' then
        return json_build_object('ok', false, 'error', 'statut_requis');
      end if;
      v_res := public.corriger_etape_by_token(p_token, p_statut);

    when 'perdu' then
      if public.origine_du_motif(p_motif) is null then
        return json_build_object(
          'ok', false, 'error', 'motif_invalide',
          'motifs_admis', array['hors_zone','doublon','hors_competence',
            'delai_incompatible','prix_trop_eleve','budget_insuffisant',
            'signe_concurrent','client_injoignable','client_renonce',
            'non_eligible_aides']);
      end if;
      -- Arguments NOMMÉS : la fonction prend la raison AVANT le motif (0079).
      v_res := public.retirer_chantier_by_token(
        p_token          := p_token,
        p_raison         := coalesce(btrim(p_message), ''),
        p_motif          := p_motif,
        p_recontacter_le := null::date);

    when 'restauration' then
      v_res := public.restaurer_chantier_by_token(p_token);

    when 'montant' then
      if p_montant is null then
        return json_build_object('ok', false, 'error', 'montant_requis');
      end if;

    when 'devis' then
      if coalesce(btrim(p_url), '') = '' then
        return json_build_object('ok', false, 'error', 'url_requise');
      end if;
      v_res := public.set_devis_by_token(p_token, v_slot, p_url);
      -- `set_devis_by_token` renvoie `{"ok": false}` NU sur échec. On le
      -- rhabille : un refus sans motif envoie l'artisan chercher la panne là
      -- où elle n'est pas.
      if (v_res->>'ok')::boolean is not true then
        v_res := json_build_object('ok', false, 'error', 'depot_refuse',
                                   'slot', v_slot);
      end if;

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
  'rupture d''écho et journal. Le dépôt d''un devis signé se dit '
  'explicitement (`p_slot: devis_signe`) : c''est lui qui engage la commission.';
