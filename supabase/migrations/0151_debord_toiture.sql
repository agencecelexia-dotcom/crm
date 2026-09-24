-- Le toit déborde des murs, et le chiffre enregistré doit le dire.
--
-- L'écran affiche une surface de toiture qui tient compte du débord ; sans
-- cette colonne, la base en enregistrait une autre, calculée sur la seule
-- emprise. L'artisan aurait recopié dans son devis un mètre carré qu'il n'avait
-- pas vu à l'écran — et l'agence en aurait lu un troisième.

alter table public.metres add column if not exists debord_m numeric;

comment on column public.metres.debord_m is
  'Débord de toiture retenu par l''artisan, en mètres. Non mesurable au LiDAR (maille de 50 cm) : c''est une saisie, pas un relevé.';

CREATE OR REPLACE FUNCTION public.enregistrer_metre_by_token(p_token text, p_affectation_token text, p_nom text, p_type text, p_geometrie jsonb, p_hauteur_m numeric DEFAULT NULL::numeric, p_pente_pct numeric DEFAULT NULL::numeric, p_source text DEFAULT 'dessin'::text, p_ouvertures_m2 numeric DEFAULT NULL::numeric, p_azimut numeric DEFAULT NULL::numeric, p_pente_source text DEFAULT NULL::text, p_hauteur_source text DEFAULT NULL::text, p_debord_m numeric DEFAULT 0)
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
  v_emprise_toit numeric;
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
    -- LE TOIT DÉBORDE DES MURS.
    --
    -- Le contour vient de la BD TOPO, qui trace le bâtiment au sol : vérifié
    -- contre le cadastre sur trois maisons, les deux coïncident à 1 % près. Le
    -- toit, lui, dépasse à l'égout de trente à cinquante centimètres. Sur une
    -- maison de 80 m², quarante centimètres ajoutent quinze mètres carrés —
    -- dans le sens qui fait commander TROP PEU de tuiles.
    --
    -- Le débord n'est pas mesurable : le LiDAR a une maille de cinquante
    -- centimètres et son bord de toit est flou d'autant. C'est donc l'artisan
    -- qui le pose, et le chiffre enregistré doit être CELUI QU'IL A VU. D'où ce
    -- paramètre plutôt qu'un recalcul silencieux depuis la seule géométrie.
    --
    -- Aire du dilaté d'un polygone : elle gagne le périmètre fois la distance,
    -- plus un disque aux angles.
    v_debord := case when p_debord_m is null or p_debord_m < 0 or p_debord_m > 2
                     then 0 else p_debord_m end;
    v_emprise_toit := v_surface + coalesce(v_perimetre, 0) * v_debord + pi() * v_debord * v_debord;
    -- Surface réelle = surface projetée / cos(angle de pente). Le cast est
    -- indispensable : cos() renvoie un double precision, et round(double, int)
    -- n'existe pas en PostgreSQL — la ligne plantait à la première pente.
    v_reelle := round((v_emprise_toit / cos(atan(v_pente / 100)))::numeric, 2);
  end if;

  insert into public.metres (projet_id, affectation_id, artisan_id, nom, type,
                             geometrie, surface_m2, perimetre_m, longueur_m,
                             hauteur_m, pente_pct, surface_reelle_m2, source, debord_m,
                             ouvertures_m2, azimut, pente_source, hauteur_source)
  values (af.projet_id, af.id, v_artisan,
          coalesce(nullif(btrim(p_nom), ''), 'Mesure'), p_type,
          p_geometrie, v_surface, v_perimetre, v_longueur,
          nullif(p_hauteur_m, 0), v_pente, v_reelle,
          case when p_source = 'bati' then 'bati' else 'dessin' end, v_debord,
          nullif(v_ouvertures, 0),
          case when p_azimut >= 0 and p_azimut <= 360 then p_azimut end,
          -- La liste blanche était restée à deux valeurs : une pente MESURÉE au
          -- LiDAR y était rejetée sans bruit et enregistrée à NULL, donc
          -- indiscernable d'une pente déduite à ±30 points. La contrainte de la
          -- 0150 les acceptait déjà ; c'est ici qu'elles se perdaient.
          case when p_pente_source in ('altitudes', 'saisie', 'lidar', 'photogrammetrie')
               then p_pente_source end,
          case when p_hauteur_source in ('bati', 'saisie') then p_hauteur_source end)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'surface_m2', v_surface,
                           'perimetre_m', v_perimetre, 'longueur_m', v_longueur,
                           'surface_reelle_m2', v_reelle, 'debord_m', v_debord);
end
$function$

;

-- Ajouter un paramètre CRÉE UNE SURCHARGE, elle ne remplace pas. L'ancienne
-- fonction à douze paramètres survivait donc, avec sa liste blanche incomplète
-- qui perdait les pentes mesurées — et PostgREST pouvait la choisir. On la
-- retire : deux vérités pour un même chiffre, c'est une de trop.
drop function if exists public.enregistrer_metre_by_token(
  text, text, text, text, jsonb, numeric, numeric, text, numeric, numeric, text, text
);
