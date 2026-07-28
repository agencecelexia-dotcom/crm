-- ============================================================
--  0062 — Deux natures de perte + nettoyage du pipe artisan.
--
--  1. Nouveau statut « mort » (AGENCE UNIQUEMENT) : le client a trouvé un
--     artisan ailleurs, le lead n'existe plus pour Celexia. À distinguer de
--     « perdu », qui signifie « cet artisan-là n'a pas conclu » — le chantier
--     reste alors vivant et réattribuable. L'artisan ne peut PAS déclarer
--     « mort » (refusé côté base, pas seulement caché dans l'UI).
--
--  2. Le pipe de l'artisan se nettoie tout seul : un chantier qu'il a passé
--     en « perdu » depuis plus de 15 jours disparaît de sa liste, ainsi que
--     les chantiers masqués explicitement et les projets devenus « morts ».
--     RIEN n'est supprimé : ses statistiques (perdus, taux de conversion,
--     commission) sont désormais calculées côté SQL sur la TOTALITÉ de ses
--     affectations et renvoyées dans un bloc `stats`.
-- ============================================================

-- ---------- 1. Statut « mort » autorisé sur les projets ----------
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.projets'::regclass and contype = 'c' and conname like '%statut%';
  if c is not null then
    execute 'alter table public.projets drop constraint ' || quote_ident(c);
  end if;
end$$;

alter table public.projets
  add constraint projets_statut_check check (statut in (
    'nouveau', 'a_rappeler', 'en_attente', 'artisan_assigne',
    'contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine',
    'perdu', 'mort'
  ));

-- ---------- 2. Colonnes de nettoyage du pipe artisan ----------
alter table public.affectations
  add column if not exists perdu_at timestamptz,
  add column if not exists masque_at timestamptz;

comment on column public.affectations.perdu_at is
  'Date de passage en « perdu » par l''artisan. Au-delà de 15 jours, le chantier sort de son pipe (mais reste dans ses stats).';
comment on column public.affectations.masque_at is
  'Masquage explicite par l''agence : le chantier disparaît du pipe de l''artisan, tout est conservé côté agence.';

-- Backfill : les pertes déjà enregistrées prennent leur date de dernière
-- modification comme date de perte (les vieilles sortent donc tout de suite).
update public.affectations
  set perdu_at = updated_at
  where statut = 'perdu' and perdu_at is null;

-- ---------- 3. add_suivi_by_token : « mort » interdit à l'artisan ----------
-- Reprise de la version 0058 (réassignation quand plus aucun artisan actif),
-- avec en plus une whitelist stricte des statuts déclarables par l'artisan et
-- l'entretien de perdu_at.
CREATE OR REPLACE FUNCTION public.add_suivi_by_token(p_token text, p_statut text DEFAULT NULL::text, p_message text DEFAULT NULL::text, p_date_rdv timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  -- Statuts déclarables par l'ARTISAN. « mort » est réservé à l'agence :
  -- seule Celexia sait qu'un client est parti chez un concurrent.
  if coalesce(p_statut, '') <> '' and p_statut not in
     ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'devis_signe', 'termine', 'perdu') then
    return json_build_object('ok', false, 'error', 'statut_non_autorise');
  end if;

  -- Justification écrite OBLIGATOIRE pour déclarer « perdu ».
  if p_statut = 'perdu' and coalesce(btrim(p_message), '') = '' then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  if coalesce(p_statut, '') <> '' then
    update public.affectations
      set statut = p_statut,
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
  elsif p_statut in ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'termine', 'perdu') then
    if exists (select 1 from public.affectations af2
               where af2.projet_id = af.projet_id and af2.statut <> 'perdu') then
      -- Au moins un artisan encore actif : le projet prend le meilleur statut actif.
      update public.projets p set statut = (
        select af2.statut from public.affectations af2
        where af2.projet_id = p.id and af2.statut <> 'perdu'
        order by case af2.statut
          when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
          when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
        limit 1)
      where p.id = af.projet_id;
    else
      -- PLUS AUCUN artisan actif : le dossier REMONTE pour réassignation
      -- (statut 'nouveau', détaché de l'artisan). Un projet déjà déclaré
      -- « mort » par l'agence reste mort — c'est une décision d'agence.
      update public.projets set statut = 'nouveau', artisan_id = null
        where id = af.projet_id and statut <> 'mort';
      insert into public.notifications (type, titre, message, projet_id)
      values ('a_reassigner',
        'A reassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
        'Plus aucun artisan actif (declare perdu). A reattribuer rapidement.'
          || case when coalesce(btrim(p_message), '') <> '' then ' Raison : ' || btrim(p_message) else '' end,
        af.projet_id);
    end if;
  end if;

  return json_build_object('ok', true);
end;
$function$;

-- ---------- 4. get_espace_artisan : pipe nettoyé + stats exhaustives ----------
create or replace function public.get_espace_artisan(p_token text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
begin
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
    'stats', (
      select json_build_object(
        'en_attente', count(*) filter (where af.statut = 'en_attente'),
        'perdus', count(*) filter (where af.statut = 'perdu' or p.statut = 'mort'),
        'devis_envoyes', count(*) filter (where af.statut = 'devis_envoye'),
        'montant_devis_envoyes', coalesce(sum(af.montant_devis) filter (where af.statut = 'devis_envoye'), 0),
        'signes', count(*) filter (where af.statut in ('devis_signe', 'termine')),
        'devis_aboutis', count(*) filter (where af.statut in ('devis_envoye', 'devis_signe', 'termine')),
        'vendu', coalesce(sum(af.montant_devis_signe) filter (where af.statut in ('devis_signe', 'termine')), 0),
        'commission_a_regler', coalesce(sum(p.commission) filter (
          where p.artisan_id = af.artisan_id and p.commission is not null and not p.commission_encaissee), 0),
        'commission_reglee', coalesce(sum(p.commission) filter (
          where p.artisan_id = af.artisan_id and p.commission_encaissee), 0)
      )
      from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id and p.deleted_at is null
    ),

    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          case af.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis, 'montant_devis_signe', af.montant_devis_signe,
            'commission', case when p.artisan_id = af.artisan_id then p.commission end,
            'commission_encaissee',
              case when p.artisan_id = af.artisan_id then p.commission_encaissee else false end,
            'client_ville', p.client_ville, 'photos', coalesce(p.photos, '{}'),
            'devis_depose', af.devis_url is not null,
            'devis_signe_depose', af.devis_signe_url is not null,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            )
          ) as p_json
        from public.affectations af
        join public.projets p on p.id = af.projet_id
        where af.artisan_id = a.id
          and p.deleted_at is null
          -- Pipe nettoyé : masqués par l'agence, perdus depuis plus de 15
          -- jours, et projets déclarés morts sortent de la liste.
          and af.masque_at is null
          and p.statut <> 'mort'
          and not (af.statut = 'perdu' and coalesce(af.perdu_at, af.updated_at) < now() - interval '15 days')
      ) sub
    )
  );
end;
$function$;
