-- Les garde-fous ne contrôlaient que la moitié du modèle.
--
-- `verifier_coherence_metriques()` (0088) affiche 9 règles vertes, et elles le
-- sont. Mais aucune ne contient `from public.projets` : tout ce qui est écrit
-- au niveau projet échappait au contrôle.
--
-- Conséquence mesurée avant cette migration : 26 anomalies invisibles, dont un
-- dossier à 91 000 € compté comme gagné alors qu'aucune de ses deux
-- affectations n'avait signé (l'une perdue, l'autre au devis envoyé).
--
-- Cinq contrôles ajoutés, les 9 existants conservés à l'identique.

CREATE OR REPLACE FUNCTION public.verifier_coherence_metriques()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       where montant_devis < 0 or montant_devis_signe < 0),

    -- ---- Contrôles au niveau PROJET (ajoutés en 0101) --------------------
    -- Les 9 règles ci-dessus ne regardent que `affectations`. Un montant ou
    -- une commission posés directement sur le projet leur échappaient : c'est
    -- ainsi qu'un dossier à 91 000 € a pu être compté comme gagné alors
    -- qu'aucun artisan n'avait signé.

    'projet_gagne_sans_affectation', (select count(*) from public.projets p
       where p.deleted_at is null and p.statut in ('devis_signe','termine')
         and not exists (select 1 from public.affectations a
                          where a.projet_id = p.id and a.retire_at is null
                            and a.issue = 'gagne')),

    'commission_sans_affectation',   (select count(*) from public.projets p
       where p.deleted_at is null and coalesce(p.commission, 0) > 0
         and not exists (select 1 from public.affectations a
                          where a.projet_id = p.id and a.retire_at is null
                            and a.issue = 'gagne')),

    -- Le taux du projet doit suivre le contrat de l'artisan. Exception
    -- assumée : CELEXIA se facture en direct à 100 %, ce n'est pas une
    -- commission d'apport.
    'taux_divergent_du_contrat',     (select count(*) from public.projets p
       join public.affectations a on a.projet_id = p.id and a.retire_at is null
       join public.artisans ar on ar.id = a.artisan_id
       where p.deleted_at is null
         and p.taux_commission <> ar.taux_commission
         and coalesce(ar.societe, '') not ilike '%celexia%'),

    'taux_hors_bornes',              (select count(*) from public.projets
       where deleted_at is null
         and (taux_commission < 0 or taux_commission > 0.30)
         and id not in (select p.id from public.projets p
                        join public.affectations a on a.projet_id = p.id
                        join public.artisans ar on ar.id = a.artisan_id
                        where coalesce(ar.societe, '') ilike '%celexia%')),

    -- Sans date, impossible de savoir depuis quand une commission est due,
    -- donc de relancer par ancienneté.
    'signe_sans_date',               (select count(*) from public.projets
       where deleted_at is null and statut in ('devis_signe','termine')
         and date_signature is null)
  );
$function$

