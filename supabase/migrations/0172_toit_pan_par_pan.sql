-- Le toit lu PAN PAR PAN : le cache garde les pans et le facteur de surface.
--
-- La pente unique (médiane de tous les pixels) supposait tous les pans
-- pareils, et la règle « deux versants dominants » refusait les toits à
-- quatre pans et les toits plats. Le calcul rend désormais, pour chaque pan,
-- sa part et sa pente médiane, la part plate du toit, et le facteur
-- surface vraie ÷ surface au sol qui en découle (_calcul-toit.ts).
--
-- Le cache doit les garder : sans eux, un toit relu depuis le cache
-- retomberait sur l'ancienne règle. Les mesures antérieures (version 2) sont
-- refaites à la prochaine ouverture.

alter table public.toiture_mesuree
  add column if not exists facteur numeric check (facteur is null or facteur between 1 and 4),
  add column if not exists part_plate numeric check (part_plate is null or part_plate between 0 and 1),
  add column if not exists pans jsonb;

-- L'ancienne signature disparaît : ajouter des paramètres crée une surcharge,
-- et l'appel de la fonction pourrait tomber sur l'une ou l'autre.
drop function if exists public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text, jsonb, numeric, numeric, integer);

create or replace function public.enregistrer_toiture(
  p_cleabs text, p_couvert boolean, p_motif text, p_pente numeric,
  p_incertitude numeric, p_pixels integer, p_versants jsonb, p_source text,
  p_murs jsonb default null, p_hauteur_gouttiere numeric default null,
  p_hauteur_faitage numeric default null, p_version integer default 3,
  p_facteur numeric default null, p_part_plate numeric default null, p_pans jsonb default null
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
  -- Un facteur de 4 est un toit à 387 % : un artefact, pas une mesure.
  if p_facteur is not null and (p_facteur < 1 or p_facteur > 4) then
    return json_build_object('ok', false, 'error', 'facteur_hors_bornes');
  end if;

  insert into public.toiture_mesuree
    (cleabs, couvert, motif, pente_pct, incertitude, pixels, versants, source,
     murs, hauteur_gouttiere, hauteur_faitage, version, facteur, part_plate, pans, mesure_le)
  values
    (btrim(p_cleabs), coalesce(p_couvert, false), p_motif, p_pente, p_incertitude,
     p_pixels, coalesce(p_versants, '[]'::jsonb), p_source,
     p_murs, p_hauteur_gouttiere, p_hauteur_faitage, coalesce(p_version, 3),
     p_facteur, p_part_plate, p_pans, now())
  on conflict (cleabs) do update
    set couvert = excluded.couvert, motif = excluded.motif,
        pente_pct = excluded.pente_pct, incertitude = excluded.incertitude,
        pixels = excluded.pixels, versants = excluded.versants, source = excluded.source,
        murs = excluded.murs, hauteur_gouttiere = excluded.hauteur_gouttiere,
        hauteur_faitage = excluded.hauteur_faitage, version = excluded.version,
        facteur = excluded.facteur, part_plate = excluded.part_plate, pans = excluded.pans,
        mesure_le = now()
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end
$function$;

revoke execute on function public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text, jsonb, numeric, numeric, integer, numeric, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text, jsonb, numeric, numeric, integer, numeric, numeric, jsonb)
  to service_role;

create or replace function public.toiture_by_token(p_token text, p_cleabs text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    'version', v.version,
    'facteur', v.facteur,
    'part_plate', v.part_plate,
    'pans', v.pans
  );
end
$function$;
