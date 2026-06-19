-- 0043 — Démarchage : pool de sociétés à contacter (importé de l'autre CRM).
-- Distinct des `artisans` (partenaires validés). Jamais exposé au portail artisan.

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  source_ref uuid unique,            -- id d'origine (idempotence de l'import)
  company_name text,
  contact_nom text, contact_prenom text,
  email text, tel text, tel2 text,
  website text, google_maps_url text,
  profession text,                   -- libellé brut d'origine
  metiers text[] not null default '{}', -- métiers CRM mappés (+ tags ajoutés au tel)
  address text, city text, code_postal text, departement text,
  siret text, siren text,
  lat double precision, lon double precision,
  statut text not null default 'a_contacter',
    -- a_contacter | pas_repondu | negatif | ok_autre_metier | interesse | converti
  rappel_at timestamptz,
  nb_appels int not null default 0,
  dernier_appel timestamptz,
  notes text,
  artisan_id uuid references public.artisans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_prospects_statut on public.prospects (statut);
create index if not exists idx_prospects_metiers on public.prospects using gin (metiers);
create index if not exists idx_prospects_dept on public.prospects (departement);
create index if not exists idx_prospects_coord on public.prospects (lat, lon);

alter table public.prospects enable row level security;
drop policy if exists "prospects_auth" on public.prospects;
create policy "prospects_auth" on public.prospects for all to authenticated using (true) with check (true);

-- Sociétés à démarcher autour d'un point, du plus proche au plus loin.
-- Exclut négatif/converti et les "pas de réponse" encore en report. p_metier null = tous métiers.
create or replace function public.prospects_autour(
  p_lat double precision, p_lon double precision,
  p_metier text default null, p_rayon_km int default 150
) returns json
language sql stable security definer set search_path = public
as $$
  with base as (
    select pr.*,
      6371 * acos(least(1, greatest(-1,
        sin(radians(p_lat)) * sin(radians(pr.lat)) +
        cos(radians(p_lat)) * cos(radians(pr.lat)) * cos(radians(pr.lon - p_lon))
      ))) as dist
    from public.prospects pr
    where pr.lat is not null and pr.lon is not null
      and pr.statut not in ('negatif', 'converti')
      and (pr.rappel_at is null or pr.rappel_at <= now())
      and (p_metier is null or p_metier = '' or p_metier = any(pr.metiers))
  ),
  top as (
    select * from base where dist <= p_rayon_km
    order by case statut when 'interesse' then 0 when 'ok_autre_metier' then 1 else 2 end, dist
    limit 150
  )
  select coalesce(json_agg(json_build_object(
    'id', id, 'company_name', company_name, 'profession', profession, 'metiers', metiers,
    'tel', tel, 'tel2', tel2, 'email', email,
    'city', city, 'code_postal', code_postal, 'departement', departement,
    'website', website, 'google_maps_url', google_maps_url,
    'statut', statut, 'nb_appels', nb_appels, 'notes', notes,
    'distance_km', round(dist::numeric, 1)
  ) order by case statut when 'interesse' then 0 when 'ok_autre_metier' then 1 else 2 end, dist), '[]'::json)
  from top
$$;

grant execute on function public.prospects_autour(double precision, double precision, text, int) to authenticated;
