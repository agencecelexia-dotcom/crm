-- 0184 — Suivi artisan cohérent, accès contractuel et reprise sans perte de devis.
-- Préparée après audit/2026-11-08-artisan-suivi-audit.md.
-- Aucune réparation de masse, aucun changement de taux ou de formule financière.
-- Les signatures non prouvées peuvent être corrigées avec confirmation UI ;
-- un document signé ou une commission encaissée exige une intervention agence.

create or replace function public.acces_suivi_par_jeton(
  p_token text, p_autoriser_retire boolean default false,
  p_exiger_contrat boolean default true
) returns text
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare af public.affectations; a public.artisans; p public.projets;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return 'token_invalide'; end if;
  select * into a from public.artisans where id = af.artisan_id;
  if a.id is null or a.ecarte_at is not null then return 'artisan_ecarte'; end if;
  select * into p from public.projets where id = af.projet_id;
  if p.id is null or p.deleted_at is not null or p.statut = 'mort' then return 'projet_clos'; end if;
  if not p_autoriser_retire and (af.retire_at is not null or af.masque_at is not null) then
    return 'chantier_retire';
  end if;
  -- Même contrat de référence que ensure_engagement_contrat, sans création
  -- de contrat ni effet secondaire pendant le contrôle d'accès.
  if p_exiger_contrat and not coalesce(a.contrat_externe, false)
     and not coalesce((select c.statut = 'signe' from public.contrats c
                        where c.artisan_id = a.id order by c.created_at asc limit 1), false) then
    return 'contrat_requis';
  end if;
  return null;
end;
$function$;
revoke execute on function public.acces_suivi_par_jeton(text, boolean, boolean) from public, anon, authenticated;



CREATE OR REPLACE FUNCTION public.definir_rappel_by_token(p_token text, p_quand timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; v_erreur text;
begin
  v_erreur := public.acces_suivi_par_jeton(p_token);
  if v_erreur is not null then
    return json_build_object('ok', false, 'error', v_erreur);
  end if;
  select * into af from public.affectations where token = p_token for update;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if p_quand is not null and (p_quand at time zone 'Europe/Paris')::date < (now() at time zone 'Europe/Paris')::date then
    return json_build_object('ok', false, 'error', 'date_passee');
  end if;

  if af.rappel_le is not distinct from p_quand then return json_build_object('ok', true); end if;

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
declare af public.affectations; v_txt text; v_erreur text;
begin
  v_erreur := public.acces_suivi_par_jeton(p_token);
  if v_erreur is not null then
    return json_build_object('ok', false, 'error', v_erreur);
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if p_resultat not in ('pas_de_reponse','repondu','rappeler','faux_numero') then
    return json_build_object('ok', false, 'error', 'resultat_invalide');
  end if;
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

CREATE OR REPLACE FUNCTION public.add_suivi_by_token(p_token text, p_statut text DEFAULT NULL::text, p_message text DEFAULT NULL::text, p_date_rdv timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  af public.affectations;
  v_erreur text;
  v_garde json;
begin
  v_erreur := public.acces_suivi_par_jeton(p_token);
  if v_erreur is not null then
    return json_build_object('ok', false, 'error', v_erreur);
  end if;
  select * into af from public.affectations where token = p_token and retire_at is null for update;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false, 'error', 'rien_a_enregistrer');
  end if;

  -- Statuts déclarables par l'ARTISAN. « mort » est réservé à l'agence :
  -- l'artisan ne décide pas qu'un lead est définitivement perdu pour tous.
  if coalesce(p_statut, '') <> '' and p_statut not in
     ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'devis_signe', 'termine', 'perdu', 'reprendre') then
    return json_build_object('ok', false, 'error', 'statut_non_autorise');
  end if;

  -- Un abandon doit être motivé : sans justification, le lead n'est pas
  -- exploitable pour comprendre pourquoi il a échoué.
  if p_statut = 'perdu' and coalesce(btrim(p_message), '') = '' then
    return json_build_object('ok', false, 'error', 'motif_requis');
  end if;

  -- Reprise sans inventer un contact ou un RDV sur une affectation neuve.
  if p_statut = 'reprendre' then
    if af.en_attente_depuis is null then return json_build_object('ok', true); end if;
    update public.affectations set en_attente_depuis = null where id = af.id;
    insert into public.suivis (projet_id, affectation_id, auteur, type, message)
    values (af.projet_id, af.id, 'artisan', 'note', 'Suivi repris, étape conservée.');
    return json_build_object('ok', true);
  end if;
  if p_statut = 'en_attente' and af.en_attente_depuis is not null then
    return json_build_object('ok', true, 'sous_statut', 'en_attente');
  end if;
  if p_statut = 'rdv_pris' and p_date_rdv is null then
    return json_build_object('ok', false, 'error', 'date_rdv_requise');
  end if;
  if p_statut = 'perdu' then
    v_garde := public.peut_abandonner_affectation(af.id);
    if (v_garde->>'ok')::boolean is false then
      return json_build_object('ok', false, 'error', v_garde->>'raison');
    end if;
  end if;
  if public.rang_etape(p_statut) > 0 and public.rang_etape(p_statut) < 4
     and (public.rang_etape(af.etape) >= 4 or af.devis_signe_url is not null) then
    if af.devis_signe_url is not null then
      return json_build_object('ok', false, 'error', 'devis_signe_depose');
    end if;
    if exists (select 1 from public.projets p where p.id = af.projet_id
                and p.artisan_id = af.artisan_id and p.commission_encaissee) then
      return json_build_object('ok', false, 'error', 'commission_encaissee');
    end if;
  end if;
  -- Un second clic sur une étape identique ne duplique ni note ni webhook.
  if p_statut = af.statut and af.en_attente_depuis is null
     and coalesce(btrim(p_message), '') = ''
     and (p_statut <> 'rdv_pris' or p_date_rdv is not distinct from af.date_rdv) then
    return json_build_object('ok', true);
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

CREATE OR REPLACE FUNCTION public.retirer_chantier_by_token(p_token text, p_raison text, p_motif text, p_recontacter_le date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; v_garde json; v_restants int; v_erreur text;
begin
  v_erreur := public.acces_suivi_par_jeton(p_token, true, false);
  if v_erreur is not null then
    return json_build_object('ok', false, 'error', v_erreur);
  end if;
  select * into af from public.affectations where token = p_token for update;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if af.retire_at is not null then return json_build_object('ok', true, 'deja_retire', true); end if;

  if length(coalesce(btrim(p_raison), '')) < 5 then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;
  if p_motif is null or p_motif not in ('prix_trop_eleve','budget_insuffisant','delai_incompatible','signe_concurrent','client_injoignable','client_renonce','hors_zone','doublon','hors_competence','non_eligible_aides','autre') then
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
         recontacter_le = case when p_motif in ('prix_trop_eleve','budget_insuffisant','delai_incompatible','client_injoignable','client_renonce','non_eligible_aides','autre') then p_recontacter_le else null end
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
  v_erreur text;
  v_statut text;
begin
  v_erreur := public.acces_suivi_par_jeton(p_token, true);
  if v_erreur is not null then
    return json_build_object('ok', false, 'error', v_erreur);
  end if;
  select * into af from public.affectations where token = p_token for update;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  select * into p from public.projets where id = af.projet_id for update;

  -- Un projet mort ou supprimé ne se récupère pas : décision d'agence.
  if p.id is null or p.deleted_at is not null or p.statut = 'mort' then
    return json_build_object('ok', false, 'error', 'projet_clos');
  end if;

  -- Ni un chantier déjà repris par un CONFRÈRE.
  if p.artisan_id is not null and p.artisan_id <> af.artisan_id then
    return json_build_object('ok', false, 'error', 'deja_attribue');
  end if;

  -- Déjà actif : ne crée pas une seconde notification après double clic.
  if af.retire_at is null and af.masque_at is null and af.statut <> 'perdu' then
    return json_build_object('ok', true, 'deja_actif', true);
  end if;
  v_statut := coalesce(af.etape, 'artisan_assigne');
  update public.affectations
     set statut = v_statut,
         issue = case when v_statut in ('devis_signe','termine') then 'gagne' else 'en_cours' end,
         retire_at = null, perdu_at = null, masque_at = null,
         en_attente_depuis = null,
         rappel_le = case when rappel_le > now() then rappel_le else null end,
         date_rdv = case when date_rdv > now() then date_rdv else null end,
         motif_perte = null, motif_perte_detail = null, origine_perte = null,
         recontacter_le = null
   where id = af.id;

  -- appliquer_etape(rdv_pris) retire normalement les rappels ; une reprise
  -- conserve pourtant ceux qui étaient encore à venir avant le retrait.
  update public.affectations
     set rappel_le = case when af.rappel_le > now() then af.rappel_le else null end
   where id = af.id;

  update public.projets
     set statut = v_statut,
         artisan_id = coalesce(artisan_id, af.artisan_id)
   where id = af.projet_id
     and statut in ('nouveau', 'a_rappeler', 'perdu', 'artisan_assigne');

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'note', null,
          'Chantier repris par l''artisan, étape et devis conservés ; rappels et rendez-vous dépassés nettoyés.');

  insert into public.notifications (type, titre, message, projet_id)
  values ('chantier_restaure',
    'Chantier repris : ' || coalesce(p.client_nom, 'chantier'),
    coalesce((select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'Un artisan')
      || ' a remis ce chantier dans son pipe.',
    af.projet_id);

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
            'recu_le', coalesce(af.created_at, p.created_at),
            'derniere_activite', greatest(af.updated_at, (select max(s.created_at) from public.suivis s where s.affectation_id = af.id)),
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
            'devis_url', case when v_signe then af.devis_url end,
            'devis_signe_url', case when v_signe then af.devis_signe_url end,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'non_lus', (select count(*) from public.suivis s2
                        where s2.affectation_id = af.id
                          and s2.auteur = 'agence' and s2.lu_at is null),
            'suivis', case when v_signe then (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                -- Le fil devient bidirectionnel : l'artisan distingue enfin
                -- une consigne de l'agence de sa propre saisie (0080).
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            ) else '[]'::json end
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
            'client_code_postal', case when v_signe then p.client_code_postal end,
            'motif_perte', af.motif_perte,
            -- Ce qui manquait pour décider d'une réattribution : l'HISTORIQUE.
            -- Le résumé d'une ligne ne dit pas si l'artisan a chiffré, à quel
            -- prix, ni pourquoi le client a dit non. Sans ces éléments, on
            -- réattribue à l'aveugle — ou on n'ose pas réattribuer du tout.
            'recu_le', coalesce(af.created_at, p.created_at),
            'etape', af.etape,
            'date_rdv', af.date_rdv,
            'montant_devis_signe', af.montant_devis_signe,
            'devis_url', case when v_signe then af.devis_url end,
            'devis_signe_url', case when v_signe then af.devis_signe_url end,
            'devis_depose', af.devis_url is not null,
            'suivis', case when v_signe then (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            ) else '[]'::json end,
            'derniere_raison', case when v_signe then (
              select s.message from public.suivis s
               where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
               order by s.created_at desc limit 1
            ) else null end
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

create or replace function public.stats_artisan_faits(p_artisan_id uuid)
returns json language sql stable security definer set search_path to 'public'
as $function$
  with af as (
    select a.*, p.commission, p.commission_encaissee, p.artisan_id as projet_artisan,
           coalesce(a.created_at, p.created_at) as lead_recu_le,
           greatest(a.updated_at, (select max(s.created_at) from public.suivis s where s.affectation_id = a.id)) as derniere_activite_effective
    from public.affectations a
    join public.projets p on p.id = a.projet_id
    where a.artisan_id = p_artisan_id and p.deleted_at is null
  ),
  jalons as (
    select s.affectation_id,
           min(s.created_at) filter (where s.statut_artisan = 'contacte')     as t_contact,
           min(s.created_at) filter (where s.statut_artisan = 'devis_envoye') as t_devis,
           min(s.created_at) filter (where s.statut_artisan = 'devis_signe')  as t_signe
    from public.suivis s group by 1
  ),
  d as (
    -- Seuil d'une minute : en deçà, les deux clics font partie de la même
    -- session de saisie et ne mesurent aucune durée réelle.
    select
      nullif(greatest(extract(epoch from (j.t_contact - af.lead_recu_le)), 0), 0) / 86400 as d_contact,
      case when extract(epoch from (j.t_devis - af.lead_recu_le)) >= 60
           then extract(epoch from (j.t_devis - af.lead_recu_le)) / 86400 end as d_devis,
      case when extract(epoch from (j.t_signe - j.t_devis)) >= 60
           then extract(epoch from (j.t_signe - j.t_devis)) / 86400 end as d_signe
    from af join jalons j on j.affectation_id = af.id
  ),
  cran as (
    select r.rang,
           count(*) filter (where rang_etape(af.etape) >= r.rang)                           as atteint,
           count(*) filter (where rang_etape(af.etape) >= r.rang and af.issue = 'en_cours') as actif,
           count(*) filter (where rang_etape(af.etape) >= r.rang and af.issue = 'perdu')    as perdu,
           count(*) filter (where rang_etape(af.etape) >= r.rang and af.issue = 'gagne')    as gagne
    from (values (1),(2),(3),(4),(5)) r(rang), af
    group by r.rang
  )
  select json_build_object(
    'leads_recus', (select count(*) from af),
    'en_cours',    (select count(*) from af where issue = 'en_cours'),
    'gagnes',      (select count(*) from af where issue = 'gagne'),
    'perdus',      (select count(*) from af where issue = 'perdu'),

    'funnel', (select json_object_agg(nom, json_build_object(
                 'atteint', atteint, 'actif', actif, 'perdu', perdu, 'gagne', gagne))
               from cran join (values
                 (1,'contacte'),(2,'rdv_pris'),(3,'devis_envoye'),
                 (4,'devis_signe'),(5,'termine')) n(rang, nom) using (rang)),

    'signatures_prouvees', (select count(*) from af
       where public.signature_prouvee(devis_signe_url, montant_devis_signe)),
    'signatures_declarees_sans_preuve', (select count(*) from af
       where rang_etape(etape) >= 4
         and not public.signature_prouvee(devis_signe_url, montant_devis_signe)),

    'montant_devis_total', (select coalesce(sum(montant_devis), 0) from af where montant_devis is not null),
    'panier_moyen',  (select coalesce(round(avg(montant_devis)), 0) from af
                       where montant_devis is not null and montant_devis > 0),
    'panier_median', (select coalesce(round(
                        percentile_cont(0.5) within group (order by montant_devis)::numeric), 0)
                      from af where montant_devis is not null and montant_devis > 0),
    'ca_signe',      (select coalesce(sum(coalesce(montant_devis_signe, montant_devis)), 0)
                       from af where issue = 'gagne'),
    'pipe_en_cours', (select coalesce(sum(montant_devis), 0) from af
                       where issue = 'en_cours' and montant_devis is not null),
    'montant_perdu', (select coalesce(sum(montant_devis), 0) from af
                       where issue = 'perdu' and montant_devis is not null),

    'commission_due',    (select coalesce(sum(commission), 0) from af
                           where issue = 'gagne' and projet_artisan = p_artisan_id
                             and not commission_encaissee),
    'commission_reglee', (select coalesce(sum(commission), 0) from af
                           where projet_artisan = p_artisan_id and commission_encaissee),

    'tranches',      (select count(*) from af where issue in ('gagne','perdu')),
    'taux_contact',  (select case when count(*) = 0 then null
                       else round(100.0 * count(*) filter (where rang_etape(etape) >= 1) / count(*)) end from af),
    'taux_rdv',      (select case when count(*) filter (where rang_etape(etape) >= 1) = 0 then null
                       else round(100.0 * count(*) filter (where rang_etape(etape) >= 2)
                                  / count(*) filter (where rang_etape(etape) >= 1)) end from af),
    'taux_devis',   (select case when count(*) filter (where rang_etape(etape) >= 2) = 0 then null
                       else round(100.0 * count(*) filter (where rang_etape(etape) >= 3)
                                  / count(*) filter (where rang_etape(etape) >= 2)) end from af),
    'taux_signature', (select case
                        when count(*) filter (where rang_etape(etape) >= 3
                                                and issue in ('gagne','perdu')) = 0 then null
                        else round(100.0 * count(*) filter (where issue = 'gagne' and rang_etape(etape) >= 3)
                                   / count(*) filter (where rang_etape(etape) >= 3
                                                and issue in ('gagne','perdu'))) end from af),
    'taux_refus_avant_devis', (select case when count(*) = 0 then null
                        else round(100.0 * count(*) filter (where issue = 'perdu'
                                                 and rang_etape(etape) < 3) / count(*)) end from af),

    -- Délais : publiés uniquement à partir de 3 observations exploitables.
    'delai_contact_j',  (select case when count(d_contact) >= 3 then
                           round(percentile_cont(0.5) within group (order by d_contact)::numeric) end from d),
    'delai_contact_n',  (select count(d_contact) from d),
    'delai_devis_j',    (select case when count(d_devis) >= 3 then
                           round(percentile_cont(0.5) within group (order by d_devis)::numeric) end from d),
    'delai_devis_n',    (select count(d_devis) from d),
    'delai_signature_j',(select case when count(d_signe) >= 3 then
                           round(percentile_cont(0.5) within group (order by d_signe)::numeric) end from d),
    'delai_signature_n',(select count(d_signe) from d),

    'rappels_echus', (select count(*) from af
                       where rappel_le is not null and rappel_le <= now() and issue = 'en_cours'),
    'jamais_contactes_48h', (select count(*) from af
                       where etape is null and issue = 'en_cours'
                         and lead_recu_le < now() - interval '48 hours'),
    'devis_sans_reponse_15j', (select count(*) from af
                       where etape = 'devis_envoye' and issue = 'en_cours'
                         and derniere_activite_effective < now() - interval '15 days')
  );
$function$;


-- Les fonctions publiques gardent les mêmes signatures et droits d'appel.
revoke execute on function public.add_suivi_by_token(text,text,text,timestamptz) from public;
grant execute on function public.add_suivi_by_token(text,text,text,timestamptz) to anon, authenticated;
revoke execute on function public.definir_rappel_by_token(text,timestamptz) from public;
grant execute on function public.definir_rappel_by_token(text,timestamptz) to anon, authenticated;
revoke execute on function public.log_appel_by_token(text,text,text) from public;
grant execute on function public.log_appel_by_token(text,text,text) to anon, authenticated;
revoke execute on function public.restaurer_chantier_by_token(text) from public;
grant execute on function public.restaurer_chantier_by_token(text) to anon, authenticated;


-- Le chemin de correction explicite applique les mêmes gardes.
CREATE OR REPLACE FUNCTION public.corriger_etape_by_token(p_token text, p_etape text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; v_erreur text;
begin
  v_erreur := public.acces_suivi_par_jeton(p_token);
  if v_erreur is not null then return json_build_object('ok', false, 'error', v_erreur); end if;
  select * into af from public.affectations where token = p_token for update;
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

  if public.rang_etape(p_etape) < 4 and exists (
    select 1 from public.projets p where p.id = af.projet_id
      and p.artisan_id = af.artisan_id and p.commission_encaissee
  ) then return json_build_object('ok', false, 'error', 'commission_encaissee'); end if;

  update public.affectations
     set etape = p_etape,
         statut = coalesce(p_etape, 'artisan_assigne'),
         issue = case when p_etape in ('devis_signe','termine') then 'gagne'
                      when issue = 'gagne' then 'en_cours' else issue end
   where id = af.id;

  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'artisan', 'note',
          'Étape corrigée manuellement : ' || coalesce(p_etape, 'aucune'));

  return json_build_object('ok', true, 'etape', p_etape);
end;
$function$;
