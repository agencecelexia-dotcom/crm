-- 0046 — Couverture apporteurs : 3 artisans actifs par ZONE × MÉTIER × SOUS-NICHE.
-- Zone = ville de référence (table zones, seedée en 0047). Comptage par ZONE DESSERVIE :
-- un artisan couvre une zone si haversine(artisan, zone) <= coalesce(rayon_km, 30) km.
-- Sans PostGIS : haversine inline (cf. 0043_prospects.sql).

-- ---------- 1) Table des zones (centres = communes peuplées) ----------
create table if not exists public.zones (
  id          text primary key,          -- code INSEE de la commune
  nom         text not null,
  lat         double precision not null,
  lon         double precision not null,
  departement text,
  region      text,
  population  integer,
  created_at  timestamptz not null default now()
);
create index if not exists idx_zones_coord on public.zones (lat, lon);
create index if not exists idx_zones_dept on public.zones (departement);

alter table public.zones enable row level security;
drop policy if exists "zones_auth" on public.zones;
create policy "zones_auth" on public.zones for all to authenticated using (true) with check (true);

-- ---------- 2) Sous-niches sur les prospects (miroir au recrutement) ----------
alter table public.prospects add column if not exists sous_metiers text[] not null default '{}';
create index if not exists idx_prospects_sous_metiers on public.prospects using gin (sous_metiers);

-- ---------- 3) Rayon de service par défaut (le dashboard compte dès J1) ----------
update public.artisans set rayon_km = 30 where rayon_km is null;

-- ---------- 4) RPC tableau : zone × sous-niche pour un métier ----------
-- p_sous_metiers vient du front (SOUS_METIERS[metier]) pour que les sous-niches À 0
-- apparaissent comme trous. p_departement optionnel (réduit le payload).
create or replace function public.couverture_grille(
  p_metier text,
  p_sous_metiers text[],
  p_cible int default 3,
  p_departement text default null
) returns json
language sql stable security definer set search_path = public
as $$
  with act as (
    select a.latitude as lat, a.longitude as lon,
           coalesce(a.rayon_km, 30) as rk, a.sous_metiers
    from public.artisans a
    where a.ecarte_at is null
      and a.latitude is not null and a.longitude is not null
      and p_metier = any(a.metiers)
  ),
  cells as (
    select z.id as zone_id, z.nom as zone, z.lat, z.lon, z.departement, sm.sous_metier,
      (select count(*) from act
        where sm.sous_metier = any(act.sous_metiers)
          and 6371 * acos(least(1, greatest(-1,
              sin(radians(z.lat)) * sin(radians(act.lat)) +
              cos(radians(z.lat)) * cos(radians(act.lat)) * cos(radians(act.lon - z.lon))
            ))) <= act.rk
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

-- ---------- 5) RPC carte : une ligne par zone pour un métier (+ sous-niche option) ----------
create or replace function public.couverture_carte(
  p_metier text,
  p_sous_metier text default null,
  p_cible int default 3
) returns json
language sql stable security definer set search_path = public
as $$
  with act as (
    select a.latitude as lat, a.longitude as lon, coalesce(a.rayon_km, 30) as rk
    from public.artisans a
    where a.ecarte_at is null
      and a.latitude is not null and a.longitude is not null
      and (case when p_sous_metier is null
                then p_metier = any(a.metiers)
                else p_sous_metier = any(a.sous_metiers) end)
  ),
  z as (
    select zz.id, zz.nom, zz.lat, zz.lon, zz.departement,
      (select count(*) from act
        where 6371 * acos(least(1, greatest(-1,
            sin(radians(zz.lat)) * sin(radians(act.lat)) +
            cos(radians(zz.lat)) * cos(radians(act.lat)) * cos(radians(act.lon - zz.lon))
          ))) <= act.rk) as n
    from public.zones zz
  )
  select coalesce(json_agg(json_build_object(
    'id', id, 'nom', nom, 'lat', lat, 'lon', lon, 'departement', departement, 'n', n,
    'statut', case when n >= p_cible then 'couvert' when n > 0 then 'partiel' else 'vide' end
  )), '[]'::json)
  from z;
$$;
grant execute on function public.couverture_carte(text, text, int) to authenticated;
