-- ============================================================
--  0084 — P2-14 : qualité des leads par source et par département.
--
--  CONSTAT (audit §2/§8) : « on ne peut ni juger la performance de l'artisan,
--  ni la qualité des leads de l'agence ». Or 22 % des chantiers transmis à
--  Batryx ont été refusés AVANT tout chiffrage : c'est un problème de ciblage,
--  pas de performance artisan. Sans mesure par source et par zone, impossible
--  de savoir d'où viennent les mauvais leads.
--
--  On s'appuie sur `origine_perte` (0079), qui distingue enfin un refus
--  artisan d'un « non » client.
--
--  ⚠️ Il n'existe AUCUNE colonne de source sur `projets` (vérifié : `source`
--  n'existe que sur `artisans`). L'analyse par canal d'acquisition est donc
--  impossible en l'état — elle demanderait d'ajouter le champ à la saisie du
--  lead. On segmente ici par MÉTIER et par DÉPARTEMENT, deux dimensions
--  réellement renseignées et déjà actionnables pour le ciblage.
-- ============================================================

create or replace function public.qualite_leads()
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select
      p.id,
      coalesce(nullif(p.metier, ''), 'non précisé') as metier,
      left(p.client_code_postal, 2) as dep,
      af.issue,
      af.etape,
      af.origine_perte,
      af.montant_devis,
      public.rang_etape(af.etape) as rang
    from public.projets p
    join public.affectations af on af.projet_id = p.id
    where p.deleted_at is null
  )
  select json_build_object(
    'par_metier', (
      select coalesce(json_agg(t order by t.transmis desc), '[]'::json) from (
        select metier,
               count(*)::int as transmis,
               count(*) filter (where issue = 'gagne')::int as gagnes,
               -- Refus AVANT chiffrage : c'est le signal de mauvais ciblage.
               count(*) filter (where origine_perte = 'artisan')::int as refuses_artisan,
               count(*) filter (where issue = 'perdu' and origine_perte = 'client')::int as perdus_client,
               coalesce(round(avg(montant_devis) filter (where montant_devis > 0)), 0) as panier_moyen,
               case when count(*) filter (where issue in ('gagne','perdu')) = 0 then null
                 else round(100.0 * count(*) filter (where issue = 'gagne')
                            / count(*) filter (where issue in ('gagne','perdu'))) end as taux_signature
        from base group by 1
      ) t),
    'par_departement', (
      select coalesce(json_agg(t order by t.transmis desc), '[]'::json) from (
        select dep,
               count(*)::int as transmis,
               count(*) filter (where issue = 'gagne')::int as gagnes,
               count(*) filter (where origine_perte = 'artisan')::int as refuses_artisan,
               count(*) filter (where rang = 0)::int as jamais_contactes
        from base where dep is not null and dep <> '' group by 1
      ) t),
    'total_transmis', (select count(*) from base),
    'total_refuses_artisan', (select count(*) from base where origine_perte = 'artisan')
  );
$function$;

revoke execute on function public.qualite_leads() from public, anon;
grant  execute on function public.qualite_leads() to authenticated, service_role;

comment on function public.qualite_leads() is
  'Qualité des leads transmis, par source et par département. Un refus artisan '
  'signale un problème de CIBLAGE ; une perte client, un problème de conversion.';
