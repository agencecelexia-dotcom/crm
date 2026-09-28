-- Enregistrer un métré À PARTIR DU RELEVÉ LiDAR : la toiture est la somme des
-- pans retenus, la façade la somme des murs relevés de son orientation.
--
-- Jusqu'ici le serveur recalculait la toiture depuis le contour du cadastre,
-- un débord choisi (40 cm par défaut) et une pente unique : « contour + débord
-- ÷ cos(pente) ». Le relevé (0177) mesure le débord côté par côté et lit
-- chaque pan à sa pente : l'écran en affiche la somme, et la base doit garder
-- LA MÊME. Elle ne fait pas confiance au navigateur pour autant : elle relit
-- le relevé écrit par la fonction et refait l'addition.
--
-- Le chemin d'avant reste entier pour les maisons sans relevé (hors
-- couverture LiDAR, relevé incertain) et pour les surfaces dessinées.

alter table public.metres
  add column if not exists releve_id uuid references public.releve_batiment (id) on delete set null,
  -- Les pans retenus (numéros du relevé) ; null = tout le toit.
  add column if not exists pans_retenus integer[];

drop function if exists public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text, numeric, numeric, text, text, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.enregistrer_metre_by_token(p_token text, p_affectation_token text, p_nom text, p_type text, p_geometrie jsonb, p_hauteur_m numeric DEFAULT NULL::numeric, p_pente_pct numeric DEFAULT NULL::numeric, p_source text DEFAULT 'dessin'::text, p_ouvertures_m2 numeric DEFAULT NULL::numeric, p_azimut numeric DEFAULT NULL::numeric, p_pente_source text DEFAULT NULL::text, p_hauteur_source text DEFAULT NULL::text, p_debord_m numeric DEFAULT 0, p_part_toiture numeric DEFAULT 1, p_versant text DEFAULT NULL::text,
  p_releve_id uuid DEFAULT NULL::uuid, p_pans integer[] DEFAULT NULL::integer[],
  p_facade_orientation text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  af public.affectations;
  v_artisan uuid;
  v_surface numeric;
  v_perimetre numeric;
  v_longueur numeric;
  v_reelle numeric;
  v_pente numeric;
  v_debord numeric;
  v_part numeric;
  v_emprise_toit numeric;
  v_ouvertures numeric;
  v_min_sommets int;
  v_id uuid;
  v_releve public.releve_batiment%rowtype;
  v_plan numeric;
  v_vrai numeric;
  v_nb int;
  v_libre numeric;
  v_hauteur numeric;
  v_pente_source text;
  v_hauteur_source text;
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
  v_hauteur := p_hauteur_m;
  v_pente_source := case when p_pente_source in ('altitudes', 'saisie', 'lidar', 'photogrammetrie')
                         then p_pente_source end;
  v_hauteur_source := case when p_hauteur_source in ('bati', 'saisie', 'lidar') then p_hauteur_source end;

  -- LE RELEVÉ FAIT FOI. Quand l'écran s'appuie sur un relevé LiDAR, le
  -- serveur ne recalcule pas depuis le contour : il relit LE MÊME relevé
  -- (écrit par la fonction, jamais par le navigateur) et en fait la somme —
  -- des pans retenus pour une toiture, des murs de l'orientation choisie pour
  -- une façade. L'écran fait la même somme : enregistré = affiché.
  if p_releve_id is not null then
    select * into v_releve from public.releve_batiment
     where id = p_releve_id and statut = 'fait' and releve is not null;
    if not found then
      return json_build_object('ok', false, 'error', 'releve_introuvable');
    end if;
  end if;

  if p_type = 'surface' and p_releve_id is not null then
    -- Les pans retenus (tous si aucun n'est précisé).
    select coalesce(sum((p ->> 'airePlan')::numeric), 0),
           coalesce(sum((p ->> 'aireVraie')::numeric), 0),
           count(*)
      into v_plan, v_vrai, v_nb
      from jsonb_array_elements(v_releve.releve -> 'pans') p
     where p_pans is null or (p ->> 'id')::int = any (p_pans);
    if v_nb = 0 or v_vrai <= 0 or v_plan <= 0 then
      return json_build_object('ok', false, 'error', 'aucun_pan');
    end if;
    v_surface   := round(v_plan, 2);
    v_perimetre := public.longueur_ligne(p_geometrie, true);
  elsif p_type = 'surface' then
    v_surface   := public.aire_polygone(p_geometrie);
    v_perimetre := public.longueur_ligne(p_geometrie, true);
  elsif p_type = 'facade' and p_releve_id is not null then
    -- Les murs de cette orientation, hors partie mitoyenne (qui ne se traite pas).
    select coalesce(sum((f ->> 'surfaceLibre')::numeric), 0),
           coalesce(sum(greatest(0, (f ->> 'longueur')::numeric - (f ->> 'accole')::numeric)), 0),
           count(*)
      into v_libre, v_longueur, v_nb
      from jsonb_array_elements(v_releve.releve -> 'facades') f
     where f ->> 'orientation' = btrim(coalesce(p_facade_orientation, ''));
    if v_nb = 0 or v_libre <= 0 or v_longueur <= 0 then
      return json_build_object('ok', false, 'error', 'facade_introuvable');
    end if;
    if v_ouvertures > v_libre then
      return json_build_object('ok', false, 'error', 'ouvertures_superieures_au_mur');
    end if;
    v_surface := round(v_libre - v_ouvertures, 2);
    v_longueur := round(v_longueur, 2);
    -- La hauteur équivalente : celle qui, sur la longueur libre, donne la surface du mur.
    v_hauteur := round(v_libre / v_longueur, 2);
    v_hauteur_source := 'lidar';
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

  -- UNE TOITURE SANS PENTE N'A PAS DE SURFACE.
  -- Une surface relevée sur un BÂTIMENT est une toiture : sans pente, on
  -- enregistrait l'emprise au sol, sans débord, en la présentant comme la
  -- toiture — un chiffre que l'artisan n'avait jamais vu à l'écran. Un toit
  -- plat se déclare avec une pente de 0 ; une surface DESSINÉE (terrain,
  -- terrasse) n'a pas de pente et reste acceptée.
  if p_type = 'surface' and coalesce(p_source, 'dessin') = 'bati' and v_pente is null and p_releve_id is null then
    return json_build_object('ok', false, 'error', 'pente_requise');
  end if;
  if p_type = 'surface' and p_releve_id is not null then
    -- Chaque pan à SA pente : la surface vraie est la somme des pans. La pente
    -- gardée est celle qui, sur la surface retenue, donne la même surface.
    v_reelle := round(v_vrai, 2);
    v_pente := round((100 * tan(acos(least(1, v_plan / v_vrai))))::numeric, 1);
    v_pente_source := 'lidar';
    -- Le débord MESURÉ (moyenne des côtés lus), borné comme une saisie.
    v_debord := (v_releve.releve -> 'debord' ->> 'moyen')::numeric;
    v_debord := case when v_debord is null or v_debord < 0 or v_debord > 2 then 0 else round(v_debord, 2) end;
    v_part := coalesce(round(least(1, v_plan / nullif((v_releve.releve -> 'surfaces' ->> 'toitPlan')::numeric, 0)), 4), 1);
  elsif p_type = 'surface' and v_surface is not null and v_pente is not null then
    -- LE TOIT DÉBORDE DES MURS.
    --
    -- Le contour vient de la BD TOPO, qui trace le bâtiment au sol : vérifié
    -- contre le cadastre sur trois maisons, les deux coïncident à 1 % près. Le
    -- toit, lui, dépasse à l'égout de trente à cinquante centimètres. Sur une
    -- maison de 80 m², quarante centimètres ajoutent quinze mètres carrés —
    -- dans le sens qui fait commander TROP PEU de tuiles.
    --
    -- Sans relevé, le débord n'est pas mesuré : la grille d'altitudes a une
    -- maille de cinquante centimètres et son bord de toit est flou d'autant.
    -- C'est donc l'artisan qui le pose, et le chiffre enregistré doit être
    -- CELUI QU'IL A VU. D'où ce paramètre plutôt qu'un recalcul silencieux.
    --
    -- Aire du dilaté d'un polygone : elle gagne le périmètre fois la distance,
    -- plus un disque aux angles.
    v_debord := case when p_debord_m is null or p_debord_m < 0 or p_debord_m > 2
                     then 0 else p_debord_m end;
    v_emprise_toit := v_surface + coalesce(v_perimetre, 0) * v_debord + pi() * v_debord * v_debord;
    -- Surface réelle = surface projetée / cos(angle de pente). Le cast est
    -- indispensable : cos() renvoie un double precision, et round(double, int)
    -- n'existe pas en PostgreSQL — la ligne plantait à la première pente.
    -- UN COUVREUR NE REFAIT PAS TOUJOURS TOUT LE TOIT.
    --
    -- Le relevé LiDAR sépare les versants par leur exposition. Quand l'artisan
    -- n'en retient qu'un, l'écran affiche sa surface — et la base doit garder
    -- LE MÊME chiffre, sans quoi le devis et le dossier se contrediraient.
    --
    -- La part est une proportion de surface projetée : exacte si les versants
    -- ont la même pente, ce qu'ils ont sur un toit courant. Elle est bornée à
    -- ]0, 1] : au-delà, ce n'est plus une part.
    v_part := case when p_part_toiture is null or p_part_toiture <= 0 or p_part_toiture > 1
                   then 1 else p_part_toiture end;
    v_reelle := round((v_emprise_toit * v_part / cos(atan(v_pente / 100)))::numeric, 2);
  end if;

  insert into public.metres (projet_id, affectation_id, artisan_id, nom, type,
                             geometrie, surface_m2, perimetre_m, longueur_m,
                             hauteur_m, pente_pct, surface_reelle_m2, source, debord_m, part_toiture, versant,
                             ouvertures_m2, azimut, pente_source, hauteur_source,
                             releve_id, pans_retenus)
  values (af.projet_id, af.id, v_artisan,
          coalesce(nullif(btrim(p_nom), ''), 'Mesure'), p_type,
          p_geometrie, v_surface, v_perimetre, v_longueur,
          nullif(v_hauteur, 0), v_pente, v_reelle,
          case when p_source = 'bati' then 'bati' else 'dessin' end, v_debord,
          v_part, nullif(btrim(coalesce(p_versant, '')), ''),
          nullif(v_ouvertures, 0),
          case when p_azimut >= 0 and p_azimut <= 360 then p_azimut end,
          -- La liste blanche était restée à deux valeurs : une pente MESURÉE au
          -- LiDAR y était rejetée sans bruit et enregistrée à NULL, donc
          -- indiscernable d'une pente déduite à ±30 points. La contrainte de la
          -- 0150 les acceptait déjà ; c'est ici qu'elles se perdaient.
          v_pente_source,
          v_hauteur_source,
          p_releve_id,
          case when p_releve_id is not null and p_type = 'surface' then p_pans end)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'surface_m2', v_surface,
                           'perimetre_m', v_perimetre, 'longueur_m', v_longueur, 'hauteur_m', v_hauteur,
                           'surface_reelle_m2', v_reelle, 'pente_pct', v_pente,
                           'debord_m', v_debord, 'part_toiture', v_part);
end
$function$
;

revoke execute on function public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text, numeric, numeric, text, text, numeric, numeric, text, uuid, integer[], text) from public;
grant execute on function public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text, numeric, numeric, text, text, numeric, numeric, text, uuid, integer[], text) to anon, authenticated;
