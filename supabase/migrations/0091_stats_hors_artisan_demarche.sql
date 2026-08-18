-- `stats_agence()` comptait les artisans démarchés comme des projets.
--
-- Mesuré avant correction, sur une insertion de test en transaction annulée :
--   projets_total   212 -> 213
--   projets_actifs  202 -> 203
--   non_attribues    80 ->  81
--
-- Le dernier est le plus gênant : la fiche apparaissait comme un lead non
-- attribué, donc comme du travail en attente. L'exclusion est faite dans la
-- CTE qui alimente tous les compteurs, plutôt que compteur par compteur — on
-- ne peut pas en oublier un.

CREATE OR REPLACE FUNCTION public.stats_agence()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with p as (
    -- « artisan_demarche » n'est pas un projet : c'est un artisan qui a
    -- démarché l'agence. L'exclure ICI plutôt que dans chaque compteur évite
    -- d'en oublier un — il gonflait projets_total, projets_actifs et
    -- non_attribues, ce dernier le présentant comme un lead à attribuer.
    select * from public.projets
     where deleted_at is null
       and statut <> 'artisan_demarche'
  ),
  af as (
    select a.* from public.affectations a
    join public.projets pr on pr.id = a.projet_id
    where pr.deleted_at is null
      and pr.statut <> 'artisan_demarche'
  )
  select json_build_object(
    -- ---------- Volume ----------
    'projets_total',        (select count(*) from p),
    'projets_actifs',       (select count(*) from p
                              where statut not in ('perdu', 'mort', 'termine')),
    'en_attente',           (select count(*) from p where statut = 'en_attente'),
    'a_rappeler',           (select count(*) from p where statut = 'a_rappeler'),
    'non_attribues',        (select count(*) from p
                              where artisan_id is null
                                and statut not in ('perdu', 'mort', 'termine')),

    -- ---------- Devis (au niveau affectation : un par artisan) ----------
    'devis_deposes',        (select count(*) from af where montant_devis is not null),
    'devis_montant_total',  (select coalesce(sum(montant_devis), 0) from af
                              where montant_devis is not null),
    'devis_montant_median', (select coalesce(
                               percentile_cont(0.5) within group (order by montant_devis), 0)
                             from af where montant_devis is not null and montant_devis > 0),
    'devis_signes',         (select count(*) from af
                              where statut in ('devis_signe', 'termine')),

    -- ---------- Pertes ----------
    'perdus',               (select count(*) from p where statut = 'perdu'),
    'morts',                (select count(*) from p where statut = 'mort'),
    'termines',             (select count(*) from p where statut = 'termine'),

    -- ---------- Conversion ----------
    -- Dénominateur : les dossiers TRANCHÉS (gagnés + définitivement perdus).
    -- Inclure les dossiers en cours écraserait artificiellement le taux.
    'conversion_tranches',  (select count(*) from p
                              where statut in ('devis_signe', 'termine', 'perdu', 'mort')),
    'conversion_gagnes',    (select count(*) from p
                              where statut in ('devis_signe', 'termine')),

    -- ---------- Argent ----------
    'ca_signe',             (select coalesce(sum(montant_devis_signe), 0) from p
                              where statut in ('devis_signe', 'termine')),
    'commission_acquise',   (select coalesce(sum(commission), 0) from p
                              where statut in ('devis_signe', 'termine')),
    'commission_encaissee', (select coalesce(sum(commission), 0) from p
                              where commission_encaissee),
    'commission_a_encaisser', (select coalesce(sum(commission), 0) from p
                              where statut in ('devis_signe', 'termine')
                                and not commission_encaissee),
    -- Espérance sur les devis envoyés non encore signés, au taux du projet.
    'commission_potentielle', (select coalesce(sum(a.montant_devis * coalesce(pr.taux_commission, 0.10)), 0)
                               from af a
                               join p pr on pr.id = a.projet_id
                               where a.statut = 'devis_envoye' and a.montant_devis is not null),

    -- ---------- Artisans ----------
    'artisans_total',       (select count(*) from public.artisans),
    'artisans_actifs',      (select count(distinct artisan_id) from af)
  );
$function$


