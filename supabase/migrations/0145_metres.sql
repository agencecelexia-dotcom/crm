-- Mesurer sans se déplacer.
--
-- CE QUE ÇA RÉSOUT
--
-- L'artisan chiffre sans connaître les quantités : il les estime au téléphone,
-- ou se déplace pour les relever. C'est ce qui a produit les douze poteaux
-- espacés de 2,50 m sur treize mètres du devis Lorblanchet.
--
-- L'orthophoto de l'IGN et le bâti de la BD TOPO sont gratuits et sans clé. Le
-- bâtiment du client est donc DÉJÀ TRACÉ, avec sa hauteur : dans le cas
-- courant l'artisan ne dessine rien, il touche la maison et lit ses mesures.
--
-- POURQUOI UNE TABLE ET NON UNE COLONNE
--
-- Ni `projets` ni `affectations` ne porte de `jsonb` libre, et un chantier
-- comporte plusieurs mesures — la toiture, la terrasse, la clôture. C'est donc
-- une table à part, sur le motif de `projet_documents` et de `suivis`.
--
-- Elle est rattachée au PROJET, pas seulement à l'affectation : les mesures
-- servent à l'artisan pour chiffrer et à l'agence pour qualifier. L'artisan qui
-- les a prises est noté, mais elles ne lui appartiennent pas en propre.

create table if not exists public.metres (
  id              uuid primary key default gen_random_uuid(),
  projet_id       uuid not null references public.projets(id) on delete cascade,
  affectation_id  uuid references public.affectations(id) on delete set null,
  artisan_id      uuid references public.artisans(id) on delete set null,
  nom             text not null,
  type            text not null check (type in ('surface', 'longueur')),
  -- Suite de sommets [[lon, lat], …], en WGS84, dans l'ordre du tracé. L'ordre
  -- GeoJSON (longitude d'abord) est conservé pour que la géométrie reparte
  -- telle quelle vers la carte sans inversion.
  geometrie       jsonb not null,
  surface_m2      numeric,
  perimetre_m     numeric,
  longueur_m      numeric,
  -- Renseignées quand la mesure vient du bâti : la hauteur permet la surface
  -- de façade, la pente la surface réelle de toiture.
  hauteur_m       numeric,
  pente_pct       numeric,
  surface_reelle_m2 numeric,
  source          text not null default 'dessin' check (source in ('bati', 'dessin')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_metres_projet on public.metres (projet_id, created_at desc);

alter table public.metres enable row level security;

do $$
begin
  drop policy if exists metres_par_projet on public.metres;
  -- Même règle que `devis` : chacun voit les mesures des projets qu'il voit.
  create policy metres_par_projet on public.metres
    for all to authenticated
    using (projet_id in (select public.mes_projets()))
    with check (projet_id in (select public.mes_projets()));
end $$;

-- ---------- La géométrie, calculée en base ----------
--
-- Le client envoie des sommets, jamais une surface : c'est le serveur qui
-- mesure, comme `creer_devis_by_token` recalcule les totaux. Une surface
-- décidée par le navigateur serait une surface qu'on ne peut pas défendre.
--
-- Formule sphérique classique, celle de Google Maps et de Leaflet.GeometryUtil.
-- Vérifiée à 0,0000 % près contre un calcul plan indépendant, sur de vrais
-- polygones de bâtiments (49, 112 et 305 m²).

create or replace function public.aire_polygone(p_geom jsonb)
returns numeric
language plpgsql
immutable
set search_path to 'pg_temp'
as $function$
declare
  R  constant numeric := 6378137;   -- rayon équatorial WGS84, en mètres
  n  int;
  s  numeric := 0;
  i  int;
  x1 numeric; y1 numeric; x2 numeric; y2 numeric;
begin
  n := jsonb_array_length(coalesce(p_geom, '[]'::jsonb));
  if n < 3 then return 0; end if;

  for i in 0 .. n - 1 loop
    x1 := (p_geom -> ((i + n - 1) % n) ->> 0)::numeric;
    y1 := (p_geom -> ((i + n - 1) % n) ->> 1)::numeric;
    x2 := (p_geom -> i ->> 0)::numeric;
    y2 := (p_geom -> i ->> 1)::numeric;
    s := s + radians(x2 - x1) * (2 + sin(radians(y1)) + sin(radians(y2)));
  end loop;

  return round(abs(s * R * R / 2), 2);
end
$function$;

revoke execute on function public.aire_polygone(jsonb) from public;

create or replace function public.longueur_ligne(p_geom jsonb, p_fermee boolean default false)
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
  dernier int;
  x1 numeric; y1 numeric; x2 numeric; y2 numeric; dx numeric; dy numeric;
begin
  n := jsonb_array_length(coalesce(p_geom, '[]'::jsonb));
  if n < 2 then return 0; end if;

  -- Un polygone se referme sur son premier sommet ; une ligne s'arrête.
  dernier := case when p_fermee then n - 1 else n - 2 end;

  for i in 0 .. dernier loop
    x1 := (p_geom -> i ->> 0)::numeric;
    y1 := (p_geom -> i ->> 1)::numeric;
    x2 := (p_geom -> ((i + 1) % n) ->> 0)::numeric;
    y2 := (p_geom -> ((i + 1) % n) ->> 1)::numeric;
    -- Projection locale : sur quelques centaines de mètres, l'écart avec
    -- Haversine est inférieur au centimètre.
    dy := radians(y2 - y1) * R;
    dx := radians(x2 - x1) * R * cos(radians((y1 + y2) / 2));
    d  := d + sqrt(dx * dx + dy * dy);
  end loop;

  return round(d, 2);
end
$function$;

revoke execute on function public.longueur_ligne(jsonb, boolean) from public;

-- ---------- Le contexte, sans toucher à `get_espace_artisan` ----------
--
-- Cette dernière ne renvoie NI latitude NI longitude — elles existent en base
-- et côté agence, jamais côté artisan. Elle a été réécrite quinze fois et
-- construit déjà un JSON immense : on ne la rouvre pas pour deux champs. Même
-- choix qu'en 0131 et 0134, une fonction dédiée.

create or replace function public.metre_contexte_by_token(
  p_token             text,
  p_affectation_token text default null
)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
  p  public.projets;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if p_affectation_token is not null then
    select * into af from public.affectations where token = p_affectation_token;
    -- Le chantier doit être le sien : le jeton d'affectation ne suffit pas.
    if af.id is null or af.artisan_id <> v_artisan then
      return json_build_object('ok', false, 'error', 'chantier_introuvable');
    end if;
    select * into p from public.projets where id = af.projet_id;
  end if;

  return json_build_object(
    'ok', true,
    'projet_id', p.id,
    'affectation_id', af.id,
    'client_ville', p.client_ville,
    -- L'adresse suit la même règle que `get_espace_artisan` : elle ne sort
    -- qu'une fois le contrat signé.
    'client_adresse', case when p.id is not null
       and exists (select 1 from public.contrats c
                    where c.artisan_id = v_artisan and c.signed_at is not null)
      then p.client_adresse end,
    'client_code_postal', p.client_code_postal,
    'latitude', p.latitude,
    'longitude', p.longitude,
    'metier', p.metier,
    'metres', (
      select coalesce(json_agg(json_build_object(
               'id', m.id, 'nom', m.nom, 'type', m.type, 'geometrie', m.geometrie,
               'surface_m2', m.surface_m2, 'perimetre_m', m.perimetre_m,
               'longueur_m', m.longueur_m, 'hauteur_m', m.hauteur_m,
               'pente_pct', m.pente_pct, 'surface_reelle_m2', m.surface_reelle_m2,
               'source', m.source, 'created_at', m.created_at)
             order by m.created_at desc), '[]'::json)
        from public.metres m where m.projet_id = p.id)
  );
end
$function$;

revoke execute on function public.metre_contexte_by_token(text, text) from public;
grant execute on function public.metre_contexte_by_token(text, text) to anon, authenticated;

-- ---------- Enregistrer une mesure ----------

create or replace function public.enregistrer_metre_by_token(
  p_token             text,
  p_affectation_token text,
  p_nom               text,
  p_type              text,
  p_geometrie         jsonb,
  p_hauteur_m         numeric default null,
  p_pente_pct         numeric default null,
  p_source            text default 'dessin'
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
  v_surface numeric;
  v_perimetre numeric;
  v_longueur numeric;
  v_reelle numeric;
  v_pente numeric;
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

  if p_type not in ('surface', 'longueur') then
    return json_build_object('ok', false, 'error', 'type_invalide');
  end if;
  -- Sommets nécessaires : trois pour une surface, deux pour une ligne. Le
  -- calcul passe par une variable car PL/pgSQL ne sait pas lire un CASE dans
  -- la condition d'un IF — il prend le THEN du CASE pour celui du IF.
  v_min_sommets := 2;
  if p_type = 'surface' then v_min_sommets := 3; end if;
  if jsonb_array_length(coalesce(p_geometrie, '[]'::jsonb)) < v_min_sommets then
    return json_build_object('ok', false, 'error', 'geometrie_insuffisante');
  end if;

  -- Les chiffres viennent d'ici, jamais du navigateur.
  if p_type = 'surface' then
    v_surface   := public.aire_polygone(p_geometrie);
    v_perimetre := public.longueur_ligne(p_geometrie, true);
  else
    v_longueur  := public.longueur_ligne(p_geometrie, false);
  end if;

  -- Une pente au-delà de 200 % (63°) n'est plus un toit ; au-delà, la
  -- correction diverge et le chiffre n'a plus de sens.
  v_pente := case when p_pente_pct is null or p_pente_pct < 0 or p_pente_pct > 200
                  then null else p_pente_pct end;
  if v_surface is not null and v_pente is not null then
    -- Surface réelle = surface projetée / cos(angle de pente). Le cast est
    -- indispensable : cos() renvoie un double precision, et round(double, int)
    -- n'existe pas en PostgreSQL — la ligne plantait à la première pente.
    v_reelle := round((v_surface / cos(atan(v_pente / 100)))::numeric, 2);
  end if;

  insert into public.metres (projet_id, affectation_id, artisan_id, nom, type,
                             geometrie, surface_m2, perimetre_m, longueur_m,
                             hauteur_m, pente_pct, surface_reelle_m2, source)
  values (af.projet_id, af.id, v_artisan,
          coalesce(nullif(btrim(p_nom), ''), 'Mesure'), p_type,
          p_geometrie, v_surface, v_perimetre, v_longueur,
          nullif(p_hauteur_m, 0), v_pente, v_reelle,
          case when p_source = 'bati' then 'bati' else 'dessin' end)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'surface_m2', v_surface,
                           'perimetre_m', v_perimetre, 'longueur_m', v_longueur,
                           'surface_reelle_m2', v_reelle);
end
$function$;

revoke execute on function public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text) from public;
grant execute on function public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text) to anon, authenticated;

create or replace function public.supprimer_metre_by_token(p_token text, p_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_artisan uuid;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  -- Il n'efface que ce qu'il a mesuré.
  delete from public.metres where id = p_id and artisan_id = v_artisan;
  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.supprimer_metre_by_token(text, uuid) from public;
grant execute on function public.supprimer_metre_by_token(text, uuid) to anon, authenticated;

-- ---------- Le CRM apprend où sont les chantiers ----------
--
-- 17 % des projets n'ont aucune coordonnée, et ceux qui arrivent par le pont
-- n'en ont jamais : le géocodage est fait par le navigateur, à la création,
-- uniquement depuis le CRM.
--
-- Quand l'artisan recadre la carte sur la vraie maison, on écrit cette
-- position sur le projet. Chaque recadrage répare une géolocalisation pour
-- tout le monde, l'agence comprise.

create or replace function public.corriger_position_by_token(
  p_token             text,
  p_affectation_token text,
  p_lat               numeric,
  p_lon               numeric
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
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

  -- France métropolitaine et outre-mer : une coordonnée hors de ces bornes est
  -- une erreur de saisie ou une inversion latitude/longitude.
  if p_lat is null or p_lon is null
     or p_lat < -25 or p_lat > 52 or p_lon < -65 or p_lon > 56 then
    return json_build_object('ok', false, 'error', 'coordonnees_invalides');
  end if;

  update public.projets
     set latitude = p_lat, longitude = p_lon
   where id = af.projet_id;

  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.corriger_position_by_token(text, text, numeric, numeric) from public;
grant execute on function public.corriger_position_by_token(text, text, numeric, numeric) to anon, authenticated;
