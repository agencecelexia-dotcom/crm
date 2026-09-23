-- Une façade peut être faite de plusieurs pans.
--
-- CE QUE L'AUDIT A MONTRÉ
--
-- Le contour d'un bâtiment de la BD TOPO compte huit à onze côtés : une maison
-- ordinaire y présentait ONZE façades, dont une de 1,21 m. Or un façadier ne
-- dit jamais « le mur numéro trois » : il dit « la façade sud », et celle-ci
-- peut être faite de trois pans séparés par un décroché.
--
-- On regroupe donc par orientation, et une façade porte désormais plusieurs
-- segments. Il faut savoir les mesurer SANS compter les vides entre eux :
-- enchaîner tous les points bout à bout ajouterait les traversées du bâtiment.
--
-- La géométrie d'une façade est donc une suite de PAIRES — début, fin, début,
-- fin — et on additionne chaque paire.

create or replace function public.longueur_pans(p_geom jsonb)
returns numeric
language plpgsql
immutable
set search_path to 'pg_temp'
as $function$
declare
  R  constant numeric := 6378137;
  n  int;
  d  numeric := 0;
  i  int;
  x1 numeric; y1 numeric; x2 numeric; y2 numeric; dx numeric; dy numeric;
begin
  n := jsonb_array_length(coalesce(p_geom, '[]'::jsonb));
  if n < 2 then return 0; end if;

  -- Deux points par pan : on avance de deux en deux et on ignore un point
  -- orphelin en fin de liste.
  i := 0;
  while i + 1 < n loop
    x1 := (p_geom -> i ->> 0)::numeric;
    y1 := (p_geom -> i ->> 1)::numeric;
    x2 := (p_geom -> (i + 1) ->> 0)::numeric;
    y2 := (p_geom -> (i + 1) ->> 1)::numeric;
    dy := radians(y2 - y1) * R;
    dx := radians(x2 - x1) * R * cos(radians((y1 + y2) / 2));
    d  := d + sqrt(dx * dx + dy * dy);
    i  := i + 2;
  end loop;

  return round(d, 2);
end
$function$;

revoke execute on function public.longueur_pans(jsonb) from public;

-- `enregistrer_metre_by_token` mesure une façade par ses pans.
create or replace function public.enregistrer_metre_by_token(
  p_token             text,
  p_affectation_token text,
  p_nom               text,
  p_type              text,
  p_geometrie         jsonb,
  p_hauteur_m         numeric default null,
  p_pente_pct         numeric default null,
  p_source            text default 'dessin',
  p_ouvertures_m2     numeric default null,
  p_azimut            numeric default null,
  p_pente_source      text default null,
  p_hauteur_source    text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  af public.affectations;
  v_artisan uuid;
  v_surface numeric;
  v_perimetre numeric;
  v_longueur numeric;
  v_reelle numeric;
  v_pente numeric;
  v_ouvertures numeric;
  v_min_sommets int;
  v_id uuid;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  select * into af from public.affectations where token = p_affectation_token;
  if af.id is null or af.artisan_id <> v_artisan then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;

  if p_type not in ('surface', 'longueur', 'facade') then
    return json_build_object('ok', false, 'error', 'type_invalide');
  end if;

  v_min_sommets := 2;
  if p_type = 'surface' then v_min_sommets := 3; end if;
  if jsonb_array_length(coalesce(p_geometrie, '[]'::jsonb)) < v_min_sommets then
    return json_build_object('ok', false, 'error', 'geometrie_insuffisante');
  end if;

  if p_hauteur_m is not null and (p_hauteur_m <= 0 or p_hauteur_m > 60) then
    return json_build_object('ok', false, 'error', 'hauteur_invalide', 'bornes', '0 à 60 m');
  end if;

  v_ouvertures := greatest(coalesce(p_ouvertures_m2, 0), 0);

  if p_type = 'surface' then
    v_surface   := public.aire_polygone(p_geometrie);
    v_perimetre := public.longueur_ligne(p_geometrie, true);
  elsif p_type = 'facade' then
    -- Somme des pans, sans les vides entre eux.
    v_longueur := public.longueur_pans(p_geometrie);
    if p_hauteur_m is null then
      return json_build_object('ok', false, 'error', 'hauteur_requise');
    end if;
    if v_ouvertures > v_longueur * p_hauteur_m then
      return json_build_object('ok', false, 'error', 'ouvertures_superieures_au_mur');
    end if;
    v_surface := round(v_longueur * p_hauteur_m - v_ouvertures, 2);
  else
    v_longueur := public.longueur_ligne(p_geometrie, false);
  end if;

  if greatest(coalesce(v_perimetre, 0), coalesce(v_longueur, 0)) > 2000 then
    return json_build_object('ok', false, 'error', 'trace_demesure');
  end if;

  v_pente := case when p_pente_pct is null or p_pente_pct < 0 or p_pente_pct > 200
                  then null else p_pente_pct end;
  if p_type = 'surface' and v_surface is not null and v_pente is not null then
    v_reelle := round((v_surface / cos(atan(v_pente / 100)))::numeric, 2);
  end if;

  insert into public.metres (projet_id, affectation_id, artisan_id, nom, type,
                             geometrie, surface_m2, perimetre_m, longueur_m,
                             hauteur_m, pente_pct, surface_reelle_m2, source,
                             ouvertures_m2, azimut, pente_source, hauteur_source)
  values (af.projet_id, af.id, v_artisan,
          coalesce(nullif(btrim(p_nom), ''), 'Mesure'), p_type,
          p_geometrie, v_surface, v_perimetre, v_longueur,
          nullif(p_hauteur_m, 0), v_pente, v_reelle,
          case when p_source = 'bati' then 'bati' else 'dessin' end,
          nullif(v_ouvertures, 0),
          case when p_azimut >= 0 and p_azimut <= 360 then p_azimut end,
          case when p_pente_source in ('altitudes', 'saisie') then p_pente_source end,
          case when p_hauteur_source in ('bati', 'saisie') then p_hauteur_source end)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'surface_m2', v_surface,
                           'perimetre_m', v_perimetre, 'longueur_m', v_longueur,
                           'surface_reelle_m2', v_reelle);
end
$function$;

revoke execute on function public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text, numeric, numeric, text, text) from public;
grant execute on function public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text, numeric, numeric, text, text) to anon, authenticated;
