-- 0053 — Zones d'intervention MULTIPLES (ville + rayon), non contiguës.
-- Ex. basé à Nantes (50 km) ET intervient aussi à Paris (30 km), sans couvrir entre les deux.
-- artisans.zones_couvertes : jsonb [{ville, lat, lon, rayon_km}, …].
-- Un artisan couvre une zone si : son département est listé, OU la zone est dans son
-- rayon « domicile », OU dans l'un de ses cercles ville+rayon.

alter table public.artisans add column if not exists zones_couvertes jsonb not null default '[]';

-- Helper haversine (km) réutilisable.
create or replace function public._haversine(
  lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision
) returns double precision language sql immutable as $$
  select case
    when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else 6371 * acos(least(1, greatest(-1,
      sin(radians(lat1)) * sin(radians(lat2)) +
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lon2 - lon1))
    )))
  end
$$;

-- ---------- RPC tableau (zone × sous-niche) ----------
create or replace function public.couverture_grille(
  p_metier text, p_sous_metiers text[], p_cible int default 3, p_departement text default null
) returns json
language sql stable security definer set search_path = public
as $$
  with act as (
    select a.latitude as lat, a.longitude as lon, a.rayon_km as rk,
           a.sous_metiers, a.departements_couverts as depts, a.zones_couvertes as zones
    from public.artisans a
    where a.ecarte_at is null
      and p_metier = any(a.metiers)
      and (a.departements_couverts <> '{}' or a.zones_couvertes <> '[]'::jsonb
           or (a.latitude is not null and a.longitude is not null))
  ),
  cells as (
    select z.id as zone_id, z.nom as zone, z.lat, z.lon, z.departement, sm.sous_metier,
      (select count(*) from act
        where sm.sous_metier = any(act.sous_metiers)
          and (
            z.departement = any(act.depts)
            or (act.rk is not null and public._haversine(z.lat, z.lon, act.lat, act.lon) <= act.rk)
            or exists (
              select 1 from jsonb_to_recordset(coalesce(act.zones, '[]'::jsonb))
                   as zc(lat double precision, lon double precision, rayon_km int)
              where public._haversine(z.lat, z.lon, zc.lat, zc.lon) <= coalesce(zc.rayon_km, 30)
            )
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
  p_metier text, p_sous_metier text default null, p_cible int default 3
) returns json
language sql stable security definer set search_path = public
as $$
  with act as (
    select a.latitude as lat, a.longitude as lon, a.rayon_km as rk,
           a.departements_couverts as depts, a.zones_couvertes as zones
    from public.artisans a
    where a.ecarte_at is null
      and (case when p_sous_metier is null then p_metier = any(a.metiers)
                else p_sous_metier = any(a.sous_metiers) end)
      and (a.departements_couverts <> '{}' or a.zones_couvertes <> '[]'::jsonb
           or (a.latitude is not null and a.longitude is not null))
  ),
  z as (
    select zz.id, zz.nom, zz.lat, zz.lon, zz.departement,
      (select count(*) from act
        where zz.departement = any(act.depts)
          or (act.rk is not null and public._haversine(zz.lat, zz.lon, act.lat, act.lon) <= act.rk)
          or exists (
            select 1 from jsonb_to_recordset(coalesce(act.zones, '[]'::jsonb))
                 as zc(lat double precision, lon double precision, rayon_km int)
            where public._haversine(zz.lat, zz.lon, zc.lat, zc.lon) <= coalesce(zc.rayon_km, 30)
          )
      ) as n
    from public.zones zz
  )
  select coalesce(json_agg(json_build_object(
    'id', id, 'nom', nom, 'lat', lat, 'lon', lon, 'departement', departement, 'n', n,
    'statut', case when n >= p_cible then 'couvert' when n > 0 then 'partiel' else 'vide' end
  )), '[]'::json)
  from z;
$$;
grant execute on function public.couverture_carte(text, text, int) to authenticated;

-- ---------- inscrire_artisan : stocke aussi zones_couvertes ----------
create or replace function public.inscrire_artisan(p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_token text; v_source text; v_contrat public.contrats; v_nb int; v_forme text;
begin
  if coalesce(trim(p_payload->>'nom'),'') = '' and coalesce(trim(p_payload->>'societe'),'') = '' then
    return json_build_object('ok', false, 'error', 'Nom ou société requis');
  end if;
  v_source := coalesce(nullif(trim(p_payload->>'source'),''), 'auto-inscription');
  v_nb := nullif(p_payload->>'nb_salaries','')::int;
  v_forme := coalesce(nullif(trim(p_payload->>'forme_juridique'),''),
                      case when v_nb = 0 then 'EI' else null end);

  insert into public.artisans (
    nom, prenom, societe, telephone, email,
    metiers, sous_metiers, rayon_km, departements_couverts, zones_couvertes,
    adresse, ville, code_postal, latitude, longitude,
    forme_juridique, capital_social, siren, ville_immatriculation,
    representant, qualite_representant, taux_commission, specificites, source,
    nb_salaries, annees_experience, assurance_rc_pro, assurance_decennale
  ) values (
    coalesce(nullif(trim(p_payload->>'nom'),''), p_payload->>'societe', 'Artisan'),
    nullif(trim(p_payload->>'prenom'),''),
    nullif(trim(p_payload->>'societe'),''),
    nullif(trim(p_payload->>'telephone'),''),
    nullif(trim(p_payload->>'email'),''),
    array(select jsonb_array_elements_text(coalesce(p_payload->'metiers','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_payload->'sous_metiers','[]'::jsonb))),
    nullif(p_payload->>'rayon_km','')::int,
    array(select jsonb_array_elements_text(coalesce(p_payload->'departements_couverts','[]'::jsonb))),
    coalesce(p_payload->'zones_couvertes', '[]'::jsonb),
    nullif(trim(p_payload->>'adresse'),''),
    nullif(trim(p_payload->>'ville'),''),
    nullif(trim(p_payload->>'code_postal'),''),
    nullif(p_payload->>'latitude','')::float8,
    nullif(p_payload->>'longitude','')::float8,
    v_forme,
    nullif(trim(p_payload->>'capital_social'),''),
    nullif(trim(p_payload->>'siren'),''),
    nullif(trim(p_payload->>'ville_immatriculation'),''),
    nullif(trim(p_payload->>'representant'),''),
    nullif(trim(p_payload->>'qualite_representant'),''),
    coalesce(nullif(p_payload->>'taux_commission','')::numeric, 0.10),
    nullif(trim(p_payload->>'specificites'),''),
    v_source,
    v_nb,
    nullif(p_payload->>'annees_experience','')::int,
    nullif(p_payload->>'assurance_rc_pro','')::boolean,
    nullif(p_payload->>'assurance_decennale','')::boolean
  ) returning id, token into v_id, v_token;

  v_contrat := public.ensure_engagement_contrat(v_id);

  return json_build_object('ok', true, 'id', v_id, 'contrat_token', v_contrat.token,
                           'espace_token', v_token, 'email', nullif(trim(p_payload->>'email'),''));
end;
$$;
grant execute on function public.inscrire_artisan(jsonb) to anon, authenticated;
