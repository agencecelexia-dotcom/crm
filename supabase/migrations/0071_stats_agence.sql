-- ============================================================
--  0071 — Statistiques agence « depuis le début », calculées en base.
--
--  Problème : le tableau de bord calcule tout côté front à partir de
--  `useProjets()`, avec deux limites qui faussent la lecture :
--    1. les chiffres sont bornés au MOIS COURANT, alors qu'on veut aussi la
--       vue cumulée depuis le début ;
--    2. les devis vivent sur `affectations` (un devis par artisan affecté),
--       table que le tableau de bord ne charge pas. Un projet envoyé à trois
--       artisans peut avoir trois devis : le front n'en voyait aucun.
--
--  Cette fonction renvoie un bloc unique, calculé sur la TOTALITÉ des données.
--  Réservée aux associés : aucune exposition à anon.
--
--  Vocabulaire des commissions, volontairement distinct :
--   • acquise      = devis SIGNÉ → la commission est due à Celexia
--   • encaissée    = déjà réglée
--   • à encaisser  = acquise − encaissée (ce qu'on doit aller chercher)
--   • potentielle  = devis ENVOYÉ mais pas encore signé, valorisé au taux du
--                    projet. C'est une espérance, pas une créance.
-- ============================================================

create or replace function public.stats_agence()
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with p as (
    select * from public.projets where deleted_at is null
  ),
  af as (
    select a.* from public.affectations a
    join public.projets pr on pr.id = a.projet_id
    where pr.deleted_at is null
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
$function$;

comment on function public.stats_agence() is
  'Statistiques agence cumulées depuis le début. Les devis sont comptés au niveau '
  'affectation (un par artisan affecté), pas au niveau projet.';

revoke execute on function public.stats_agence() from public, anon;
grant  execute on function public.stats_agence() to authenticated;
