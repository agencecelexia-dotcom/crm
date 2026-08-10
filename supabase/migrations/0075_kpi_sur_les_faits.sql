-- ============================================================
--  0075 — P0 : les KPI lisent les FAITS, plus le champ `statut`.
--
--  Écarts constatés dans l'audit produit, tous dus à la même cause — un KPI
--  filtrant sur `statut` alors que le statut était écrasable :
--
--   • « Vendu » ignorait les chantiers passés en « Terminé » : un dossier
--     réalisé sortait du CA. Désormais : issue = 'gagne', qui englobe
--     devis signé ET terminé.
--   • « Devis envoyés : 2 » ne comptait que statut = 'devis_envoye', alors
--     qu'une vingtaine de dossiers portaient déjà un montant chiffré tout en
--     étant « en attente » — environ 600 000 € invisibles. Désormais : tout
--     dossier ayant atteint l'étape « devis envoyé », quel que soit son état
--     courant.
--   • Le taux de conversion valait 1÷2. Désormais : signés ÷ dossiers
--     TRANCHÉS (gagnés + perdus), les dossiers en cours étant exclus du
--     dénominateur au lieu de l'écraser.
--   • Commission et « Vendu » utilisaient deux moteurs différents dans la
--     même page. Désormais une seule base : issue = 'gagne'.
--
--  Ajoute aussi les KPI d'apporteur d'affaires qui manquaient : taux de
--  contact, de RDV, de devis, panier moyen, délais moyens, valeur du pipe.
-- ============================================================

create or replace function public.stats_artisan_faits(p_artisan_id uuid)
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with af as (
    select a.*, p.commission, p.commission_encaissee, p.artisan_id as projet_artisan,
           p.created_at as lead_recu_le
    from public.affectations a
    join public.projets p on p.id = a.projet_id
    where a.artisan_id = p_artisan_id and p.deleted_at is null
  ),
  jalons as (
    -- Premier passage à chaque étape, pour mesurer les délais réels.
    select s.affectation_id,
           min(s.created_at) filter (where s.statut_artisan = 'contacte')     as t_contact,
           min(s.created_at) filter (where s.statut_artisan = 'devis_envoye') as t_devis,
           min(s.created_at) filter (where s.statut_artisan = 'devis_signe')  as t_signe
    from public.suivis s group by 1
  )
  select json_build_object(
    -- ---------- Volume ----------
    'leads_recus',      (select count(*) from af),
    'en_cours',         (select count(*) from af where issue = 'en_cours'),
    'gagnes',           (select count(*) from af where issue = 'gagne'),
    'perdus',           (select count(*) from af where issue = 'perdu'),

    -- ---------- Funnel, sur l'étape atteinte (cumulatif) ----------
    'contactes',        (select count(*) from af where rang_etape(etape) >= 1),
    'rdv',              (select count(*) from af where rang_etape(etape) >= 2),
    'devis_envoyes',    (select count(*) from af where rang_etape(etape) >= 3),
    'devis_signes',     (select count(*) from af where rang_etape(etape) >= 4),
    'termines',         (select count(*) from af where etape = 'termine'),

    -- ---------- Argent : tout dossier chiffré compte ----------
    'montant_devis_total', (select coalesce(sum(montant_devis), 0) from af
                             where montant_devis is not null),
    'panier_moyen',     (select coalesce(round(avg(montant_devis)), 0) from af
                          where montant_devis is not null and montant_devis > 0),
    'panier_median',    (select coalesce(round(
                            percentile_cont(0.5) within group (order by montant_devis)::numeric), 0)
                          from af where montant_devis is not null and montant_devis > 0),
    -- CA signé : issue = gagne, donc « terminé » n'en sort plus.
    'ca_signe',         (select coalesce(sum(coalesce(montant_devis_signe, montant_devis)), 0)
                          from af where issue = 'gagne'),
    -- Pipe : ce qui est encore jouable, valorisé au devis chiffré.
    'pipe_en_cours',    (select coalesce(sum(montant_devis), 0) from af
                          where issue = 'en_cours' and montant_devis is not null),

    -- ---------- Commission : une seule base ----------
    'commission_due',   (select coalesce(sum(commission), 0) from af
                          where issue = 'gagne' and projet_artisan = p_artisan_id
                            and not commission_encaissee),
    'commission_reglee',(select coalesce(sum(commission), 0) from af
                          where projet_artisan = p_artisan_id and commission_encaissee),

    -- ---------- Taux, sur dossiers TRANCHÉS ----------
    'tranches',         (select count(*) from af where issue in ('gagne','perdu')),
    'taux_contact',     (select case when count(*) = 0 then null
                           else round(100.0 * count(*) filter (where rang_etape(etape) >= 1)
                                      / count(*)) end from af),
    'taux_rdv',         (select case when count(*) filter (where rang_etape(etape) >= 1) = 0 then null
                           else round(100.0 * count(*) filter (where rang_etape(etape) >= 2)
                                      / count(*) filter (where rang_etape(etape) >= 1)) end from af),
    'taux_devis',       (select case when count(*) filter (where rang_etape(etape) >= 2) = 0 then null
                           else round(100.0 * count(*) filter (where rang_etape(etape) >= 3)
                                      / count(*) filter (where rang_etape(etape) >= 2)) end from af),
    'taux_signature',   (select case when count(*) filter (where issue in ('gagne','perdu')) = 0 then null
                           else round(100.0 * count(*) filter (where issue = 'gagne')
                                      / count(*) filter (where issue in ('gagne','perdu'))) end from af),

    -- ---------- Délais réels, en jours ----------
    'delai_contact_j',  (select round(avg(extract(epoch from (j.t_contact - af.lead_recu_le)) / 86400))
                          from af join jalons j on j.affectation_id = af.id
                          where j.t_contact is not null),
    'delai_devis_j',    (select round(avg(extract(epoch from (j.t_devis - af.lead_recu_le)) / 86400))
                          from af join jalons j on j.affectation_id = af.id
                          where j.t_devis is not null),
    'delai_signature_j',(select round(avg(extract(epoch from (j.t_signe - j.t_devis)) / 86400))
                          from af join jalons j on j.affectation_id = af.id
                          where j.t_signe is not null and j.t_devis is not null),

    -- ---------- Urgences, pour le bloc « À faire aujourd'hui » ----------
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

revoke execute on function public.stats_artisan_faits(uuid) from public, anon;
grant  execute on function public.stats_artisan_faits(uuid) to authenticated, service_role;

comment on function public.stats_artisan_faits(uuid) is
  'KPI d''un artisan calculés sur les FAITS (étape atteinte, issue, montants), '
  'jamais sur le champ statut qui était écrasable. Base unique pour le CA, les '
  'devis et la commission — les trois divergeaient auparavant.';
