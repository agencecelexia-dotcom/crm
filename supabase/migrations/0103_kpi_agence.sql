-- Source UNIQUE des indicateurs de l'agence.
--
-- Le problème réglé ici : deux compteurs du même écran ne lisaient pas la même
-- table. `conversion_gagnes` comptait 17 via `projets.statut`, `devis_signes`
-- en comptait 14 via `affectations` — soit 92 750 € d'écart sur le CA affiché.
--
-- Décision : **l'affectation fait foi**. C'est le seul niveau où l'on sait QUI
-- a signé. Un montant posé sur un projet sans affectation gagnée n'est pas un
-- chiffre d'affaires, c'est une anomalie — et elle est désormais remontée par
-- `verifier_coherence_metriques()` (0101) plutôt que silencieusement additionnée.
--
-- Deuxième principe : chaque indicateur porte le nom de ce qu'il mesure.
-- « taux de signature » valait 26 % côté artisan et 11 % côté agence ; les deux
-- étaient justes, mais le même mot désignait deux calculs. Ils sont renommés
-- avec leur dénominateur dans le nom.

create or replace function public.kpi_agence(
  p_debut date default null,
  p_fin   date default null
)
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  -- Périmètre : les affectations non retirées de la période. Les retraits
  -- restent comptés dans `leads_transmis` (un lead rendu a bien été envoyé)
  -- mais sortent des taux de conversion.
  af as (
    select a.*, p.client_ville, p.metier, p.created_by, p.assigne_a,
           p.commission, p.commission_encaissee, p.taux_commission,
           p.montant_devis_signe as montant_projet
    from public.affectations a
    join public.projets p on p.id = a.projet_id
    where p.deleted_at is null
      and p.statut not in ('artisan_demarche', 'demarchage')
      and (p_debut is null or a.created_at::date >= p_debut)
      and (p_fin   is null or a.created_at::date <= p_fin)
  ),
  actives as (select * from af where retire_at is null),

  -- Jalons horodatés, reconstitués depuis les suivis.
  -- `date_signature` n'est renseignée que sur 3 dossiers sur 15 ; les suivis
  -- en couvrent 12. C'est donc eux qui font foi pour mesurer les délais.
  jalons as (
    select s.affectation_id,
           min(s.created_at) filter (where s.statut_artisan = 'contacte')     as t_contact,
           min(s.created_at) filter (where s.statut_artisan = 'rdv_pris')     as t_rdv,
           min(s.created_at) filter (where s.statut_artisan = 'devis_envoye') as t_devis,
           min(s.created_at) filter (where s.statut_artisan = 'devis_signe')  as t_signe
    from public.suivis s
    group by 1
  ),
  delais as (
    select
      -- Seuil de 60 s : en deçà, deux clics de la même session de saisie ne
      -- mesurent aucune durée réelle.
      case when extract(epoch from (j.t_contact - a.created_at)) >= 60
           then extract(epoch from (j.t_contact - a.created_at)) / 86400 end as d_contact,
      case when extract(epoch from (j.t_signe - a.created_at)) >= 60
           then extract(epoch from (j.t_signe - a.created_at)) / 86400 end as d_signature,
      case when extract(epoch from (j.t_signe - j.t_devis)) >= 60
           then extract(epoch from (j.t_signe - j.t_devis)) / 86400 end as d_devis_signe
    from af a join jalons j on j.affectation_id = a.id
    where a.issue = 'gagne'
  )

  select json_build_object(
    -- ---------- Volume ----------
    'leads_transmis',        (select count(*) from af),
    'leads_actifs',          (select count(*) from actives where issue = 'en_cours'),
    'leads_rendus',          (select count(*) from af where retire_at is not null),
    'artisans_sollicites',   (select count(distinct artisan_id) from af),

    -- ---------- Parcours ----------
    'jamais_ouverts',        (select count(*) from actives
                               where etape is null and issue = 'en_cours'),
    'contactes',             (select count(*) from af where rang_etape(etape) >= 1),
    'rdv_pris',              (select count(*) from af where rang_etape(etape) >= 2),
    'devis_envoyes',         (select count(*) from af where rang_etape(etape) >= 3),
    'signes',                (select count(*) from af where issue = 'gagne'),
    'perdus',                (select count(*) from af where issue = 'perdu'),

    -- ---------- Taux, dénominateur nommé ----------
    -- « sur_transmis » : sur TOUT ce qui est parti chez un artisan.
    -- « sur_devis »    : seulement sur les dossiers arrivés au chiffrage.
    -- Les deux sont utiles ; les confondre était l'erreur.
    'taux_ouverture_sur_transmis', (select case when count(*) > 0 then
       round(100.0 * count(*) filter (where rang_etape(etape) >= 1) / count(*)) end from af),
    'taux_devis_sur_transmis',     (select case when count(*) > 0 then
       round(100.0 * count(*) filter (where rang_etape(etape) >= 3) / count(*)) end from af),
    'taux_signature_sur_devis',    (select case
       when count(*) filter (where rang_etape(etape) >= 3 and issue <> 'en_cours') > 0
       then round(100.0 * count(*) filter (where issue = 'gagne')
            / count(*) filter (where rang_etape(etape) >= 3 and issue <> 'en_cours')) end from af),
    'taux_conversion_global',      (select case
       when count(*) filter (where issue <> 'en_cours' or retire_at is not null) > 0
       then round(100.0 * count(*) filter (where issue = 'gagne')
            / count(*) filter (where issue <> 'en_cours' or retire_at is not null)) end from af),

    -- ---------- Délais, en jours ----------
    -- La médiane plutôt que la moyenne : un dossier signé à 34 jours ne doit
    -- pas déplacer l'indicateur de toute une équipe.
    'delai_ouverture_j',     (select round(percentile_cont(0.5)
                               within group (order by d_contact)::numeric, 1) from delais),
    'delai_signature_j',     (select round(percentile_cont(0.5)
                               within group (order by d_signature)::numeric, 1) from delais),
    'delai_devis_signe_j',   (select round(percentile_cont(0.5)
                               within group (order by d_devis_signe)::numeric, 1) from delais),
    'delai_signature_n',     (select count(d_signature) from delais),

    -- ---------- Argent ----------
    -- Tout part de l'affectation gagnée : c'est le seul niveau qui sait QUI a
    -- signé. Un montant posé sur un projet orphelin n'entre pas ici.
    'ca_signe',              (select coalesce(sum(coalesce(montant_devis_signe, montant_devis)), 0)
                               from af where issue = 'gagne'),
    'panier_moyen',          (select round(avg(coalesce(montant_devis_signe, montant_devis)))
                               from af where issue = 'gagne'
                                 and coalesce(montant_devis_signe, montant_devis) > 0),
    'panier_median',         (select round(percentile_cont(0.5) within group (
                                 order by coalesce(montant_devis_signe, montant_devis))::numeric)
                               from af where issue = 'gagne'
                                 and coalesce(montant_devis_signe, montant_devis) > 0),
    'devis_moyen_envoye',    (select round(avg(montant_devis)) from af
                               where rang_etape(etape) >= 3 and montant_devis > 0),
    'devis_median_envoye',   (select round(percentile_cont(0.5)
                               within group (order by montant_devis)::numeric)
                               from af where rang_etape(etape) >= 3 and montant_devis > 0),
    'pipe_chiffre',          (select coalesce(sum(montant_devis), 0) from actives
                               where issue = 'en_cours' and montant_devis > 0),
    'montant_perdu',         (select coalesce(sum(montant_devis), 0) from af
                               where issue = 'perdu' and montant_devis > 0),

    -- ---------- Commission ----------
    -- Calculée sur les projets gagnés uniquement, pour la même raison.
    'commission_acquise',    (select coalesce(sum(distinct_p.commission), 0)
                               from (select distinct on (a.projet_id) a.projet_id, a.commission
                                     from af a where a.issue = 'gagne') distinct_p),
    'commission_encaissee',  (select coalesce(sum(distinct_p.commission), 0)
                               from (select distinct on (a.projet_id) a.projet_id, a.commission,
                                            a.commission_encaissee
                                     from af a where a.issue = 'gagne') distinct_p
                               where distinct_p.commission_encaissee),
    'commission_a_encaisser',(select coalesce(sum(distinct_p.commission), 0)
                               from (select distinct on (a.projet_id) a.projet_id, a.commission,
                                            a.commission_encaissee
                                     from af a where a.issue = 'gagne') distinct_p
                               where not coalesce(distinct_p.commission_encaissee, false)),
    'taux_commission_moyen', (select round(avg(taux_commission) * 100, 1)
                               from af where issue = 'gagne'),

    'periode_debut', p_debut,
    'periode_fin',   p_fin
  );
$$;

comment on function public.kpi_agence(date, date) is
  'Source UNIQUE des indicateurs agence. Tout part de `affectations` : c''est le seul niveau qui sait quel artisan a signé. Chaque taux porte son dénominateur dans son nom.';

revoke execute on function public.kpi_agence(date, date) from public, anon;
grant execute on function public.kpi_agence(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Même chose par artisan : mêmes définitions, mêmes noms, comparable ligne
-- à ligne avec le total agence.

create or replace function public.kpi_par_artisan(
  p_debut date default null,
  p_fin   date default null
)
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with af as (
    select a.*, coalesce(ar.societe, ar.nom) as artisan_nom, ar.id as art_id,
           p.commission, p.commission_encaissee
    from public.affectations a
    join public.projets p on p.id = a.projet_id
    left join public.artisans ar on ar.id = a.artisan_id
    where p.deleted_at is null
      and p.statut not in ('artisan_demarche', 'demarchage')
      and (p_debut is null or a.created_at::date >= p_debut)
      and (p_fin   is null or a.created_at::date <= p_fin)
  ),
  jalons as (
    select s.affectation_id,
           min(s.created_at) filter (where s.statut_artisan = 'devis_signe') as t_signe
    from public.suivis s group by 1
  )
  select coalesce(json_agg(x order by x.ca_signe desc nulls last), '[]'::json)
  from (
    select
      af.art_id as artisan_id,
      af.artisan_nom,
      count(*) as leads_transmis,
      count(*) filter (where af.retire_at is not null) as rendus,
      count(*) filter (where af.etape is null and af.issue = 'en_cours'
                         and af.retire_at is null) as jamais_ouverts,
      count(*) filter (where rang_etape(af.etape) >= 3) as devis_envoyes,
      count(*) filter (where af.issue = 'gagne') as signes,
      count(*) filter (where af.issue = 'perdu') as perdus,

      case when count(*) filter (where af.issue <> 'en_cours' or af.retire_at is not null) > 0
        then round(100.0 * count(*) filter (where af.issue = 'gagne')
             / count(*) filter (where af.issue <> 'en_cours' or af.retire_at is not null))
      end as taux_conversion_global,

      coalesce(sum(coalesce(af.montant_devis_signe, af.montant_devis))
               filter (where af.issue = 'gagne'), 0) as ca_signe,
      round(avg(coalesce(af.montant_devis_signe, af.montant_devis))
            filter (where af.issue = 'gagne'
                      and coalesce(af.montant_devis_signe, af.montant_devis) > 0)) as panier_moyen,

      -- Réactivité : combien de jours entre l'envoi du chantier et la signature.
      round(percentile_cont(0.5) within group (
        order by case when extract(epoch from (j.t_signe - af.created_at)) >= 60
                      then extract(epoch from (j.t_signe - af.created_at)) / 86400 end
      )::numeric, 1) as delai_signature_j
    from af
    left join jalons j on j.affectation_id = af.id
    where af.art_id is not null
    group by af.art_id, af.artisan_nom
  ) x;
$$;

comment on function public.kpi_par_artisan(date, date) is
  'Mêmes indicateurs que kpi_agence, ventilés par artisan. Comparables ligne à ligne avec le total.';

revoke execute on function public.kpi_par_artisan(date, date) from public, anon;
grant execute on function public.kpi_par_artisan(date, date) to authenticated;
