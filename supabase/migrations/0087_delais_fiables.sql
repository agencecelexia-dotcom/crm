-- ============================================================
--  0087 — Un délai n'est publié que s'il est mesurable.
--
--  CONSTAT : « devis → signature : 0 j » sur 4 dossiers retenus, dont 3 avec
--  les deux étapes horodatées À LA SECONDE PRÈS. L'artisan a cliqué les deux
--  crans d'affilée en rattrapant sa saisie : ce n'est pas un délai nul, c'est
--  une absence de mesure. Publier « 0 j » revient à affirmer que ses clients
--  signent instantanément — faux, et invérifiable.
--
--  Deux règles posées ici :
--   1. un écart de moins d'une minute entre deux jalons est une SAISIE
--      GROUPÉE, pas une durée : il est exclu du calcul ;
--   2. un délai n'est renvoyé que si l'échantillon atteint 3 observations.
--      En dessous, on renvoie null et l'interface n'affiche rien, plutôt
--      qu'un chiffre qu'on présenterait comme un indicateur.
--
--  Les délais sont accompagnés de leur effectif (`_n`), pour que l'affichage
--  puisse dire sur quoi il repose.
-- ============================================================

create or replace function public.stats_artisan_faits(p_artisan_id uuid)
returns json language sql stable security definer set search_path to 'public'
as $function$
  with af as (
    select a.*, p.commission, p.commission_encaissee, p.artisan_id as projet_artisan,
           p.created_at as lead_recu_le
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
                         and updated_at < now() - interval '15 days')
  );
$function$;
