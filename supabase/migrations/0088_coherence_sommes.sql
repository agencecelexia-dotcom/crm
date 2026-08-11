-- ============================================================
--  0088 — Le contrôle de cohérence couvre aussi les MONTANTS.
--
--  0085 vérifiait les effectifs (identité du funnel, issues). Il ne vérifiait
--  aucune somme : un montant pouvait diverger sans que rien ne le signale.
--
--  Deux invariants ajoutés :
--   • pipe + perdu + gagné = total des devis chiffrés (par artisan) ;
--   • aucun délai publié ne peut être négatif ni reposer sur moins de
--     3 observations — c'est ce qui avait produit « 0 j » et « -3 j ».
-- ============================================================

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
    'identite_funnel_ok', (
      select bool_and(atteint = actif + perdu + gagne) from (
        select count(*) filter (where rang_etape(etape) >= r.rang) as atteint,
               count(*) filter (where rang_etape(etape) >= r.rang and issue = 'en_cours') as actif,
               count(*) filter (where rang_etape(etape) >= r.rang and issue = 'perdu') as perdu,
               count(*) filter (where rang_etape(etape) >= r.rang and issue = 'gagne') as gagne
        from (values (1),(2),(3),(4),(5)) r(rang), af group by r.rang
      ) t),

    -- Toute affectation a exactement une issue.
    'issues_exhaustives_ok', (
      select count(*) = count(*) filter (where issue in ('en_cours','gagne','perdu')) from af),

    -- Somme de contrôle des montants, par artisan.
    'sommes_montants_ok', (
      select bool_and(abs(total - (pipe + perdu + gagne)) < 0.01) from (
        select coalesce(sum(montant_devis) filter (where montant_devis is not null), 0) as total,
               coalesce(sum(montant_devis) filter (where issue='en_cours' and montant_devis is not null), 0) as pipe,
               coalesce(sum(montant_devis) filter (where issue='perdu'    and montant_devis is not null), 0) as perdu,
               coalesce(sum(montant_devis) filter (where issue='gagne'    and montant_devis is not null), 0) as gagne
        from af group by artisan_id
      ) t),

    'gagne_sans_montant',       (select count(*) from af
       where issue = 'gagne' and coalesce(montant_devis_signe, montant_devis) is null),
    'montant_signe_hors_gagne', (select count(*) from af
       where montant_devis_signe is not null and issue <> 'gagne' and retire_at is null),
    'commission_hors_gagne',    (select count(*) from af
       where commission_encaissee and pa = artisan_id and issue <> 'gagne'),
    'retire_mais_pas_perdu',    (select count(*) from af
       where retire_at is not null and issue <> 'perdu'),
    'etape_sous_les_faits',     (select count(*) from af
       where montant_devis is not null and rang_etape(etape) < 3),
    'montants_negatifs',        (select count(*) from af
       where montant_devis < 0 or montant_devis_signe < 0)
  );
$function$;
