-- Ce qu'il faut traiter aujourd'hui, chiffré.
--
-- Le tableau de bord ouvrait sur des totaux cumulés — utiles pour un bilan,
-- inutiles pour décider quoi faire ce matin. Cette fonction renvoie les quatre
-- chiffres qui appellent une action, chacun rattaché à un écran.
--
-- Elle s'appuie sur `projets.origine` (migration 0111) : sans cette colonne,
-- « leads neufs » comptait 76 projets dont 61 étaient en réalité des retours
-- d'artisan.

create or replace function public.a_traiter()
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    'a_encaisser_n', (
      select count(*) from public.projets
       where deleted_at is null
         and statut = 'devis_signe'
         and not coalesce(commission_encaissee, false)
    ),
    'a_encaisser_montant', coalesce((
      select sum(commission) from public.projets
       where deleted_at is null
         and statut = 'devis_signe'
         and not coalesce(commission_encaissee, false)
    ), 0),

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
    )
  );
$function$;

comment on function public.a_traiter() is
  'Les chiffres qui appellent une action aujourd''hui : leads neufs à '
  'attribuer, commissions à encaisser, chantiers à replacer, sommes dues aux '
  'commerciaux. S''appuie sur projets.origine (0111).';

revoke all on function public.a_traiter() from public, anon;
grant execute on function public.a_traiter() to authenticated;
