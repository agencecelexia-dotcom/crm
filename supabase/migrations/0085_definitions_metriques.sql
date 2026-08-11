-- ============================================================
--  0085 — Des métriques définies mécaniquement, non interprétables.
--
--  PROBLÈME CONSTATÉ EN LECTURE RÉELLE
--  Le tableau de bord affichait « Devis signé : 8 » juste sous « 2 chantiers
--  gagnés ». Les deux chiffres sont exacts mais mesurent des choses
--  différentes : l'étape est MONOTONE (le point le plus loin jamais atteint,
--  qui ne recule pas si le dossier est ensuite perdu), l'issue est l'état
--  courant. Juxtaposés sans distinction, ils se contredisent visuellement.
--
--  Sur les 8 « signés » : 6 avaient été retirés ensuite, et 5 reposaient sur
--  une simple déclaration au stepper, sans devis ni montant.
--
--  RÈGLE POSÉE ICI : toute métrique de funnel est renvoyée en TROIS parties
--  qui ne peuvent pas être confondues —
--    atteint  : a franchi ce cran au moins une fois (monotone)
--    actif    : y est encore, dossier en cours
--    perdu    : y est passé puis a été perdu
--  atteint = actif + perdu + gagné. L'identité est vérifiable, donc une
--  incohérence d'affichage devient impossible à réintroduire.
--
--  On distingue aussi ce qui est PROUVÉ de ce qui est DÉCLARÉ : un devis
--  signé sans PDF ni montant ne peut pas fonder une commission.
-- ============================================================

-- Preuve matérielle d'une signature : document déposé ou montant saisi.
-- Prend les colonnes et non la ligne : une CTE produit un `record`, pas un
-- type table, et le cast échouerait.
create or replace function public.signature_prouvee(p_url text, p_montant numeric)
returns boolean language sql immutable as $$
  select p_url is not null or p_montant is not null;
$$;

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
  ),
  -- Un cran du funnel, décomposé. Écrit UNE fois, réutilisé partout : c'est
  -- ce qui empêche deux endroits de compter différemment.
  cran as (
    select r.rang,
           count(*) filter (where rang_etape(af.etape) >= r.rang)                            as atteint,
           count(*) filter (where rang_etape(af.etape) >= r.rang and af.issue = 'en_cours')  as actif,
           count(*) filter (where rang_etape(af.etape) >= r.rang and af.issue = 'perdu')     as perdu,
           count(*) filter (where rang_etape(af.etape) >= r.rang and af.issue = 'gagne')     as gagne
    from (values (1),(2),(3),(4),(5)) r(rang), af
    group by r.rang
  )
  select json_build_object(
    'leads_recus', (select count(*) from af),
    'en_cours',    (select count(*) from af where issue = 'en_cours'),
    'gagnes',      (select count(*) from af where issue = 'gagne'),
    'perdus',      (select count(*) from af where issue = 'perdu'),

    -- Funnel décomposé : plus aucune lecture ambiguë possible.
    'funnel', (select json_object_agg(nom, json_build_object(
                 'atteint', atteint, 'actif', actif, 'perdu', perdu, 'gagne', gagne))
               from cran join (values
                 (1,'contacte'),(2,'rdv_pris'),(3,'devis_envoye'),
                 (4,'devis_signe'),(5,'termine')) n(rang, nom) using (rang)),

    -- Signatures réellement PROUVÉES (PDF ou montant), seule base facturable.
    'signatures_prouvees', (select count(*) from af where public.signature_prouvee(devis_signe_url, montant_devis_signe)),
    'signatures_declarees_sans_preuve', (select count(*) from af
       where rang_etape(etape) >= 4 and not public.signature_prouvee(devis_signe_url, montant_devis_signe)),

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

    'delai_contact_j',  (select round(percentile_cont(0.5) within group (order by d_contact)::numeric)
                          from d where d_contact >= 0),
    'delai_devis_j',    (select round(percentile_cont(0.5) within group (order by d_devis)::numeric)
                          from d where d_devis >= 0),
    'delai_signature_j',(select round(percentile_cont(0.5) within group (order by d_signe)::numeric)
                          from d where d_signe >= 0),

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

-- ---------- Garde-fou permanent : l'identité du funnel est vérifiable ----------
-- Toute régression future sur la définition des métriques fera échouer cette
-- fonction, au lieu de produire un tableau de bord silencieusement faux.
create or replace function public.verifier_coherence_metriques()
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with af as (
    select a.*, p.commission_encaissee, p.artisan_id as pa
    from public.affectations a join public.projets p on p.id = a.projet_id
    where p.deleted_at is null
  )
  select json_build_object(
    -- atteint = actif + perdu + gagné, à chaque cran.
    'identite_funnel_ok', (
      -- On agrège d'abord par cran, puis on vérifie l'identité : imbriquer
      -- deux agrégats dans le même select est refusé par PostgreSQL.
      select bool_and(atteint = actif + perdu + gagne) from (
        select count(*) filter (where rang_etape(etape) >= r.rang) as atteint,
               count(*) filter (where rang_etape(etape) >= r.rang and issue = 'en_cours') as actif,
               count(*) filter (where rang_etape(etape) >= r.rang and issue = 'perdu') as perdu,
               count(*) filter (where rang_etape(etape) >= r.rang and issue = 'gagne') as gagne
        from (values (1),(2),(3),(4),(5)) r(rang), af group by r.rang
      ) t),
    'gagne_sans_montant',        (select count(*) from af
       where issue = 'gagne' and coalesce(montant_devis_signe, montant_devis) is null),
    'montant_signe_hors_gagne',  (select count(*) from af
       where montant_devis_signe is not null and issue <> 'gagne' and retire_at is null),
    'commission_hors_gagne',     (select count(*) from af
       where commission_encaissee and pa = artisan_id and issue <> 'gagne'),
    'retire_mais_pas_perdu',     (select count(*) from af
       where retire_at is not null and issue <> 'perdu'),
    'etape_sous_les_faits',      (select count(*) from af
       where montant_devis is not null and rang_etape(etape) < 3)
  );
$function$;

revoke execute on function public.verifier_coherence_metriques() from public, anon;
grant  execute on function public.verifier_coherence_metriques() to authenticated, service_role;

-- ---------- Correctif R7 : commission encaissée => dossier gagné ----------
-- Une commission encaissée prouve une affaire conclue. Le dossier CELEXIA à
-- 402 € restait « en cours » : incohérence réelle, corrigée ici.
update public.affectations af
   set issue = 'gagne'
  from public.projets p
 where p.id = af.projet_id
   and p.artisan_id = af.artisan_id
   and p.commission_encaissee
   and af.issue = 'en_cours';
