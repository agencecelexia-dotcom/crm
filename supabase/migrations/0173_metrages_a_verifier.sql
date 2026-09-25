-- « Métrés à vérifier » dans « À traiter ».
--
-- Le dossier de métrés (0171) rapproche ce que dit le client de ce que
-- mesure l'outil. Un écart n'a de valeur que s'il est tranché avant que
-- l'artisan ne chiffre : il remonte donc là où l'agence commence sa journée.

CREATE OR REPLACE FUNCTION public.a_traiter()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select json_build_object(
    -- 1. Des leads jamais partis chez un artisan. Chaque jour d'attente est
    --    un client qui appelle un concurrent.
    'leads_neufs', (
      select count(*) from public.projets
       where deleted_at is null
         and origine = 'neuf'
         and statut not in ('mort', 'devis_signe', 'termine',
                            'artisan_demarche', 'demarchage')
    ),
    'leads_neufs_vieux', (
      select count(*) from public.projets
       where deleted_at is null
         and origine = 'neuf'
         and statut not in ('mort', 'devis_signe', 'termine',
                            'artisan_demarche', 'demarchage')
         and created_at < now() - interval '3 days'
    ),

    -- 2. Signé mais pas encore encaissé : c'est de l'argent dû à l'agence.
    -- Même définition partout (commissions_dues, 0166) : une affaire réellement
    -- gagnée par un artisan. Le statut « devis_signe » seul oubliait les
    -- chantiers terminés.
    'a_encaisser_n', (select count(*) from public.commissions_dues()),
    'a_encaisser_montant', coalesce((select sum(commission) from public.commissions_dues()), 0),

    -- 3. Plus aucun artisan dessus : à replacer. C'est la zone de commission
    --    du commercial.
    'a_reprendre', (
      select count(*) from public.projets
       where deleted_at is null
         and origine = 'reprise'
         and statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
         and assigne_a is null
    ),
    'repris_en_cours', (
      select count(*) from public.projets
       where deleted_at is null
         and assigne_a is not null
         and statut not in ('mort', 'devis_signe', 'termine')
    ),

    -- 4. Ce qui est dû aux commerciaux, une fois la commission encaissée.
    'a_verser', coalesce((
      select sum(montant) from public.retrocessions where verse_at is null
    ), 0),

    -- 5. Santé du pipe artisan : ce qui vit, et ce qui dort.
    'chez_artisan', (
      select count(*) from public.projets
       where deleted_at is null
         and origine = 'chez_artisan'
         and statut not in ('mort', 'devis_signe', 'termine')
    ),
    'chez_artisan_dormants', (
      select count(*) from public.projets p
       where p.deleted_at is null
         and p.origine = 'chez_artisan'
         and p.statut not in ('mort', 'devis_signe', 'termine')
         and p.updated_at < now() - interval '21 days'
    ),

    -- 6. Des métrés où la parole du client et la mesure divergent (0171) :
    --    à trancher avant que l'artisan ne chiffre. Seulement les chantiers
    --    que le membre voit, comme la table elle-même.
    'metrages_a_verifier', (
      select count(distinct m.projet_id) from public.metrage_chantier m
        join public.projets p on p.id = m.projet_id
       where m.statut in ('ecart', 'sources_desaccord')
         and p.deleted_at is null
         and m.projet_id in (select public.mes_projets())
    )
  );
$function$;
