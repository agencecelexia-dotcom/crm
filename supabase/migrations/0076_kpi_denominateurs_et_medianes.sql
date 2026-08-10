-- ============================================================
--  0076 — Correctifs sur les KPI, révélés par la confrontation aux données.
--
--  1. TAUX DE SIGNATURE. Le dénominateur « tous les dossiers tranchés »
--     incluait 44 retraits dont la plupart n'ont jamais été chiffrés : un
--     lead refusé d'emblée pesait autant qu'un devis perdu au dernier moment.
--     Le taux tombait à 4 %, ce qui ne mesurait plus rien.
--     → dénominateur restreint aux dossiers RÉELLEMENT ARBITRÉS, c'est-à-dire
--       ceux ayant au moins atteint l'étape « devis envoyé ».
--     On expose en parallèle `taux_acceptation_lead`, qui mesure l'autre
--     phénomène : la part de leads refusés avant tout chiffrage.
--
--  2. DÉLAIS. Deux dossiers portent une signature horodatée AVANT l'envoi du
--     devis (saisie rétroactive), ce qui rendait la moyenne négative (-3 j).
--     → passage à la MÉDIANE, insensible à ces valeurs, et exclusion explicite
--       des durées négatives qui n'ont pas de sens physique.
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
    select af.id,
           extract(epoch from (j.t_contact - af.lead_recu_le)) / 86400 as d_contact,
           extract(epoch from (j.t_devis   - af.lead_recu_le)) / 86400 as d_devis,
           extract(epoch from (j.t_signe   - j.t_devis))       / 86400 as d_signe
    from af join jalons j on j.affectation_id = af.id
  )
  select json_build_object(
    'leads_recus',      (select count(*) from af),
    'en_cours',         (select count(*) from af where issue = 'en_cours'),
    'gagnes',           (select count(*) from af where issue = 'gagne'),
    'perdus',           (select count(*) from af where issue = 'perdu'),

    'contactes',        (select count(*) from af where rang_etape(etape) >= 1),
    'rdv',              (select count(*) from af where rang_etape(etape) >= 2),
    'devis_envoyes',    (select count(*) from af where rang_etape(etape) >= 3),
    'devis_signes',     (select count(*) from af where rang_etape(etape) >= 4),
    'termines',         (select count(*) from af where etape = 'termine'),

    'montant_devis_total', (select coalesce(sum(montant_devis), 0) from af where montant_devis is not null),
    'panier_moyen',     (select coalesce(round(avg(montant_devis)), 0) from af
                          where montant_devis is not null and montant_devis > 0),
    'panier_median',    (select coalesce(round(
                            percentile_cont(0.5) within group (order by montant_devis)::numeric), 0)
                          from af where montant_devis is not null and montant_devis > 0),
    'ca_signe',         (select coalesce(sum(coalesce(montant_devis_signe, montant_devis)), 0)
                          from af where issue = 'gagne'),
    'pipe_en_cours',    (select coalesce(sum(montant_devis), 0) from af
                          where issue = 'en_cours' and montant_devis is not null),
    -- Ce que les retraits après chiffrage ont coûté : information stratégique.
    'montant_perdu',    (select coalesce(sum(montant_devis), 0) from af
                          where issue = 'perdu' and montant_devis is not null),

    'commission_due',   (select coalesce(sum(commission), 0) from af
                          where issue = 'gagne' and projet_artisan = p_artisan_id
                            and not commission_encaissee),
    'commission_reglee',(select coalesce(sum(commission), 0) from af
                          where projet_artisan = p_artisan_id and commission_encaissee),

    'tranches',         (select count(*) from af where issue in ('gagne','perdu')),
    'taux_contact',     (select case when count(*) = 0 then null
                           else round(100.0 * count(*) filter (where rang_etape(etape) >= 1) / count(*)) end from af),
    'taux_rdv',         (select case when count(*) filter (where rang_etape(etape) >= 1) = 0 then null
                           else round(100.0 * count(*) filter (where rang_etape(etape) >= 2)
                                      / count(*) filter (where rang_etape(etape) >= 1)) end from af),
    'taux_devis',       (select case when count(*) filter (where rang_etape(etape) >= 2) = 0 then null
                           else round(100.0 * count(*) filter (where rang_etape(etape) >= 3)
                                      / count(*) filter (where rang_etape(etape) >= 2)) end from af),
    -- Signature : uniquement parmi les dossiers réellement chiffrés et arbitrés.
    'taux_signature',   (select case
                           when count(*) filter (where rang_etape(etape) >= 3
                                                   and issue in ('gagne','perdu')) = 0 then null
                           else round(100.0 * count(*) filter (where issue = 'gagne'
                                                    and rang_etape(etape) >= 3)
                                      / count(*) filter (where rang_etape(etape) >= 3
                                                   and issue in ('gagne','perdu'))) end from af),
    -- Part des leads refusés avant tout chiffrage : mesure la qualité des leads.
    'taux_refus_avant_devis', (select case when count(*) = 0 then null
                           else round(100.0 * count(*) filter (where issue = 'perdu'
                                                    and rang_etape(etape) < 3) / count(*)) end from af),

    -- Médianes : robustes aux saisies rétroactives (2 signatures antérieures
    -- à leur devis rendaient la moyenne négative).
    'delai_contact_j',  (select round(percentile_cont(0.5) within group (order by d_contact)::numeric)
                          from d where d_contact >= 0),
    'delai_devis_j',    (select round(percentile_cont(0.5) within group (order by d_devis)::numeric)
                          from d where d_devis >= 0),
    'delai_signature_j',(select round(percentile_cont(0.5) within group (order by d_signe)::numeric)
                          from d where d_signe >= 0),

    'rappels_echus',    (select count(*) from af
                          where rappel_le is not null and rappel_le <= now() and issue = 'en_cours'),
    'jamais_contactes_48h', (select count(*) from af
                          where etape is null and issue = 'en_cours'
                            and lead_recu_le < now() - interval '48 hours'),
    'devis_sans_reponse_15j', (select count(*) from af
                          where etape = 'devis_envoye' and issue = 'en_cours'
                            and updated_at < now() - interval '15 days')
  );
$function$;
