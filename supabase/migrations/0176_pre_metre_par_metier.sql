-- La pré-mesure s'en tient au MÉTIER du chantier.
--
-- Le premier jour, elle a mesuré 8 960 m² de façades pour un parquet à
-- poser dans un local de Nice, et 2 394 m² pour un dégât des eaux à
-- Villeurbanne : les vrais chiffres de l'immeuble, et rien d'utile à
-- l'artisan. Elle ne mesure désormais que les quantités du métier
-- (METRAGE_PAR_METIER, supabase/functions/_metrage.ts), et seulement pour les
-- métiers qu'elle sait mesurer : toiture, façades, terrain.

drop function if exists public.projets_a_premesurer(integer);

create or replace function public.projets_a_premesurer(p_limite integer default 6)
returns table (
  id uuid, metier text, metiers text[],
  client_adresse text, client_code_postal text, client_ville text,
  latitude numeric, longitude numeric,
  batiment_cleabs text, batiment_source text, batiment_confirme_at timestamptz,
  batiment_lon numeric, batiment_lat numeric
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, p.metier, p.metiers,
         p.client_adresse, p.client_code_postal, p.client_ville,
         p.latitude::numeric, p.longitude::numeric,
         p.batiment_cleabs, p.batiment_source, p.batiment_confirme_at,
         p.batiment_lon, p.batiment_lat
    from public.projets p
   where p.deleted_at is null
     and p.statut not in ('mort', 'termine', 'perdu', 'artisan_demarche', 'demarchage')
     and p.client_adresse ~ '^\s*\d'
     -- Les métiers dont l'outil sait mesurer une quantité (toit, murs, terrain).
     and (p.metier = any (array['Couverture', 'Toiture', 'Solaire / Photovoltaïque', 'Façade / Ravalement',
                                'Isolation', 'Peinture', 'Maçonnerie', 'Clôture', 'Paysagisme', 'Piscine'])
          or coalesce(p.metiers, '{}') && array['Couverture', 'Toiture', 'Solaire / Photovoltaïque',
                                'Façade / Ravalement', 'Isolation', 'Peinture', 'Maçonnerie', 'Clôture',
                                'Paysagisme', 'Piscine'])
     and exists (select 1 from public.affectations a where a.projet_id = p.id and a.retire_at is null)
     and not exists (select 1 from public.metrage_chantier m where m.projet_id = p.id and m.valeur_mesuree is not null)
     and (p.metrage_tente_le is null or p.metrage_tente_le < now() - interval '1 day')
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limite, 6), 20));
$function$;

revoke execute on function public.projets_a_premesurer(integer) from public, anon, authenticated;
grant execute on function public.projets_a_premesurer(integer) to service_role;

-- Les mesures déjà écrites hors du métier disparaissent — seulement celles
-- que l'outil a posées seul : rien de ce qu'un client a dit ni de ce qu'un
-- humain a tranché n'est touché.
with par_metier(metier, cle) as (
  values
    ('Couverture', 'toit_surface'), ('Couverture', 'toit_pente'), ('Couverture', 'toit_pans'),
    ('Toiture', 'toit_surface'), ('Toiture', 'toit_pente'), ('Toiture', 'toit_pans'),
    ('Solaire / Photovoltaïque', 'toit_surface'), ('Solaire / Photovoltaïque', 'toit_pente'),
    ('Solaire / Photovoltaïque', 'toit_pans'),
    ('Façade / Ravalement', 'facades_total'), ('Façade / Ravalement', 'hauteur_murs'),
    ('Isolation', 'facades_total'), ('Isolation', 'hauteur_murs'), ('Isolation', 'toit_surface'),
    ('Peinture', 'facades_total'), ('Peinture', 'hauteur_murs'),
    ('Maçonnerie', 'facades_total'), ('Maçonnerie', 'hauteur_murs'),
    ('Clôture', 'parcelle_surface'), ('Paysagisme', 'parcelle_surface'), ('Piscine', 'parcelle_surface')
)
delete from public.metrage_chantier m
 using public.projets p
 where p.id = m.projet_id
   and m.valeur_declaree is null
   and m.statut <> 'confirme'
   and not exists (
     select 1 from par_metier pm
      where pm.cle = m.cle
        and (pm.metier = p.metier or pm.metier = any (coalesce(p.metiers, '{}')))
   );
