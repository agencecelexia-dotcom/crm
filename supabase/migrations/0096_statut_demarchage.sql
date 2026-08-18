-- Statut « demarchage » : ni un client, ni un artisan — un vendeur.
--
-- Troisième nature d'appel après « client » et « artisan_demarche » : agences
-- web, référencement, assurances, énergie, fournisseurs. Ils appellent
-- l'agence pour lui vendre quelque chose.
--
-- Distinct d'« artisan démarché », et la différence est opérationnelle : un
-- artisan qui cherche du travail est un fournisseur POTENTIEL, sa fiche sert
-- de vivier quand un chantier tombe hors zone couverte. Un vendeur de sites
-- web n'a aucune valeur future — la fiche ne sert qu'à ne pas le rappeler et
-- à reconnaître son numéro s'il insiste.
--
-- Distinct aussi de « mort », qui désigne un lead client perdu : celui-ci n'a
-- jamais été un lead.

alter table public.projets drop constraint if exists projets_statut_check;

alter table public.projets add constraint projets_statut_check check (
  statut = any (array[
    'nouveau', 'a_rappeler', 'en_attente', 'artisan_assigne', 'contacte',
    'rdv_pris', 'devis_envoye', 'devis_signe', 'termine', 'perdu', 'mort',
    'artisan_demarche', 'demarchage'
  ])
);

comment on column public.projets.statut is
  'Étape du pipeline. « mort » = lead client sans suite. « artisan_demarche » = artisan cherchant du travail, à ne pas rappeler comme prospect mais utile au recrutement. « demarchage » = sollicitation commerciale (agence web, assurance, énergie), sans valeur future.';

-- Rang 0 comme « nouveau » : ce statut ne fait pas avancer un projet, il le
-- sort du pipeline. Sans cette ligne, `rang_statut()` renverrait -1 et le
-- trigger de synchronisation (0089) le traiterait comme une valeur inconnue.
create or replace function public.rang_statut(p_statut text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_statut
    when 'nouveau'          then 0
    when 'artisan_demarche' then 0
    when 'demarchage'       then 0
    when 'a_rappeler'       then 1
    when 'en_attente'       then 2
    when 'artisan_assigne'  then 3
    when 'contacte'         then 4
    when 'rdv_pris'         then 5
    when 'devis_envoye'     then 6
    when 'devis_signe'      then 7
    when 'termine'          then 8
    else -1
  end;
$$;

-- Verrouillé au même titre que « perdu » et « artisan_demarche » : c'est une
-- qualification humaine, qu'aucune affectation ne doit écraser.
create or replace function public.statut_projet_verrouille(p_statut text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_statut in ('perdu', 'mort', 'artisan_demarche', 'demarchage');
$$;

revoke execute on function public.rang_statut(text) from public, anon;
revoke execute on function public.statut_projet_verrouille(text) from public, anon;

-- `stats_agence()` doit ignorer ce statut comme elle ignore déjà
-- « artisan_demarche » (0091) : un démarcheur n'est pas un projet, et le
-- compter gonflerait `non_attribues`, qui se lit comme du travail en attente.
-- Définition reprise telle quelle, seules les deux exclusions changent.

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
       and statut not in ('artisan_demarche', 'demarchage')
  ),
  af as (
    select a.* from public.affectations a
    join public.projets pr on pr.id = a.projet_id
    where pr.deleted_at is null
      and pr.statut not in ('artisan_demarche', 'demarchage')
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

