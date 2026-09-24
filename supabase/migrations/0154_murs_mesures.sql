-- Les murs se mesurent, eux aussi.
--
-- La hauteur de la BD TOPO a été comparée au LiDAR sur quinze maisons : un
-- tiers s'écarte de 3,6 à 4,8 m, et une hauteur unique ne dit ni le pignon ni
-- le terrain en pente. `toiture-lidar` mesure désormais chaque mur le long du
-- contour ; le cache doit garder ces profils.
--
-- `version` distingue les mesures faites avant (1, sans murs) et après (2) :
-- une mesure ancienne est refaite au prochain passage plutôt que servie
-- incomplète.

alter table public.toiture_mesuree add column if not exists murs jsonb;
alter table public.toiture_mesuree add column if not exists hauteur_gouttiere numeric(5,1);
alter table public.toiture_mesuree add column if not exists hauteur_faitage numeric(5,1);
alter table public.toiture_mesuree add column if not exists version integer not null default 1;

CREATE OR REPLACE FUNCTION public.toiture_by_token(p_token text, p_cleabs text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_artisan uuid;
  v         public.toiture_mesuree%rowtype;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null limit 1;
  if v_artisan is null then
    return json_build_object('trouvee', false, 'error', 'token_invalide');
  end if;
  if coalesce(btrim(p_cleabs), '') = '' then
    return json_build_object('trouvee', false);
  end if;

  select * into v from public.toiture_mesuree where cleabs = btrim(p_cleabs);
  if not found then
    return json_build_object('trouvee', false);
  end if;

  return json_build_object(
    'trouvee', true,
    'couvert', v.couvert,
    'motif', v.motif,
    'pente', v.pente_pct,
    'incertitude', v.incertitude,
    'pixels', v.pixels,
    'versants', v.versants,
    'source', v.source,
    'mesure_le', v.mesure_le,
    'murs', v.murs,
    'hauteur_gouttiere', v.hauteur_gouttiere,
    'hauteur_faitage', v.hauteur_faitage,
    'version', v.version
  );
end
$function$

;

drop function if exists public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text);

create or replace function public.enregistrer_toiture(
  p_cleabs text, p_couvert boolean, p_motif text, p_pente numeric,
  p_incertitude numeric, p_pixels integer, p_versants jsonb, p_source text,
  p_murs jsonb default null, p_hauteur_gouttiere numeric default null,
  p_hauteur_faitage numeric default null, p_version integer default 2
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'error', 'reserve_service');
  end if;
  if coalesce(btrim(p_cleabs), '') = '' then
    return json_build_object('ok', false, 'error', 'cleabs_requis');
  end if;
  if p_couvert and (p_pente is null or p_pente < 0 or p_pente > 300) then
    return json_build_object('ok', false, 'error', 'pente_hors_bornes');
  end if;
  -- Une maison de 80 m de haut n'est pas une maison : on ne garde pas le chiffre.
  if p_hauteur_faitage is not null and (p_hauteur_faitage < 0 or p_hauteur_faitage > 80) then
    return json_build_object('ok', false, 'error', 'hauteur_hors_bornes');
  end if;

  insert into public.toiture_mesuree
    (cleabs, couvert, motif, pente_pct, incertitude, pixels, versants, source,
     murs, hauteur_gouttiere, hauteur_faitage, version, mesure_le)
  values
    (btrim(p_cleabs), coalesce(p_couvert, false), p_motif, p_pente, p_incertitude,
     p_pixels, coalesce(p_versants, '[]'::jsonb), p_source,
     p_murs, p_hauteur_gouttiere, p_hauteur_faitage, coalesce(p_version, 2), now())
  on conflict (cleabs) do update
    set couvert = excluded.couvert, motif = excluded.motif,
        pente_pct = excluded.pente_pct, incertitude = excluded.incertitude,
        pixels = excluded.pixels, versants = excluded.versants, source = excluded.source,
        murs = excluded.murs, hauteur_gouttiere = excluded.hauteur_gouttiere,
        hauteur_faitage = excluded.hauteur_faitage, version = excluded.version,
        mesure_le = now()
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end
$function$;

revoke execute on function public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text, jsonb, numeric, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text, jsonb, numeric, numeric, integer)
  to service_role;
