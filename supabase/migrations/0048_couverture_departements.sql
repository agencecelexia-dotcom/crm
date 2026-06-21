-- 0048 — Zone desservie d'un artisan en DEUX modes (au choix au recrutement) :
--   • rayon (km) autour de son adresse  → rayon_km
--   • liste de départements desservis    → departements_couverts
-- Un artisan couvre une zone si : son département figure dans departements_couverts
-- OU la zone est dans son rayon. (rayon_km null = pas de couverture par rayon.)

alter table public.artisans
  add column if not exists departements_couverts text[] not null default '{}';
create index if not exists idx_artisans_depts on public.artisans using gin (departements_couverts);

-- ---------- RPC tableau (zone × sous-niche) ----------
create or replace function public.couverture_grille(
  p_metier text,
  p_sous_metiers text[],
  p_cible int default 3,
  p_departement text default null
) returns json
language sql stable security definer set search_path = public
as $$
  with act as (
    select a.latitude as lat, a.longitude as lon, a.rayon_km as rk,
           a.sous_metiers, a.departements_couverts as depts
    from public.artisans a
    where a.ecarte_at is null
      and p_metier = any(a.metiers)
      and (a.departements_couverts <> '{}' or (a.latitude is not null and a.longitude is not null))
  ),
  cells as (
    select z.id as zone_id, z.nom as zone, z.lat, z.lon, z.departement, sm.sous_metier,
      (select count(*) from act
        where sm.sous_metier = any(act.sous_metiers)
          and (
            z.departement = any(act.depts)
            or (act.lat is not null and act.lon is not null and act.rk is not null
                and 6371 * acos(least(1, greatest(-1,
                    sin(radians(z.lat)) * sin(radians(act.lat)) +
                    cos(radians(z.lat)) * cos(radians(act.lat)) * cos(radians(act.lon - z.lon))
                  ))) <= act.rk)
          )
      ) as n
    from public.zones z
    cross join unnest(p_sous_metiers) as sm(sous_metier)
    where p_departement is null or z.departement = p_departement
  )
  select coalesce(json_agg(json_build_object(
    'zone_id', zone_id, 'zone', zone, 'lat', lat, 'lon', lon, 'departement', departement,
    'sous_metier', sous_metier, 'n', n,
    'statut', case when n >= p_cible then 'couvert' when n > 0 then 'partiel' else 'vide' end
  ) order by zone, sous_metier), '[]'::json)
  from cells;
$$;
grant execute on function public.couverture_grille(text, text[], int, text) to authenticated;

-- ---------- RPC carte (une ligne par zone) ----------
create or replace function public.couverture_carte(
  p_metier text,
  p_sous_metier text default null,
  p_cible int default 3
) returns json
language sql stable security definer set search_path = public
as $$
  with act as (
    select a.latitude as lat, a.longitude as lon, a.rayon_km as rk,
           a.departements_couverts as depts
    from public.artisans a
    where a.ecarte_at is null
      and (case when p_sous_metier is null
                then p_metier = any(a.metiers)
                else p_sous_metier = any(a.sous_metiers) end)
      and (a.departements_couverts <> '{}' or (a.latitude is not null and a.longitude is not null))
  ),
  z as (
    select zz.id, zz.nom, zz.lat, zz.lon, zz.departement,
      (select count(*) from act
        where zz.departement = any(act.depts)
          or (act.lat is not null and act.lon is not null and act.rk is not null
              and 6371 * acos(least(1, greatest(-1,
                  sin(radians(zz.lat)) * sin(radians(act.lat)) +
                  cos(radians(zz.lat)) * cos(radians(act.lat)) * cos(radians(act.lon - zz.lon))
                ))) <= act.rk)) as n
    from public.zones zz
  )
  select coalesce(json_agg(json_build_object(
    'id', id, 'nom', nom, 'lat', lat, 'lon', lon, 'departement', departement, 'n', n,
    'statut', case when n >= p_cible then 'couvert' when n > 0 then 'partiel' else 'vide' end
  )), '[]'::json)
  from z;
$$;
grant execute on function public.couverture_carte(text, text, int) to authenticated;
