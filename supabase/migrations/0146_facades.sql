-- Une façade n'est ni une surface dessinée ni une longueur.
--
-- CE QUI ÉTAIT FAUX
--
-- 0145 proposait « surface de façade = périmètre × hauteur », c'est-à-dire
-- l'ENVELOPPE ENTIÈRE du bâtiment. Personne ne vend ça. Un façadier chiffre
-- UNE façade — celle qui est décollée, celle qui est plein sud — et il en
-- déduit les fenêtres et les portes.
--
-- Chaque côté de l'emprise est un mur. Sa surface vaut sa longueur par la
-- hauteur du bâtiment, moins les ouvertures. Et comme on connaît la géométrie,
-- on connaît son ORIENTATION : « la façade sud », celle dont parle le client
-- au téléphone.
--
-- LA PENTE, ELLE, SE CALCULE
--
-- 0145 la faisait deviner à l'artisan avec des pastilles. La BD TOPO donne
-- pourtant l'altitude de la gouttière et celle du faîtage : la pente s'en
-- déduit, rapportée à la demi-largeur du bâtiment. On enregistre donc aussi
-- d'où vient la pente — calculée ou saisie — pour ne pas confondre plus tard
-- une mesure et une estimation.

alter table public.metres
  add column if not exists ouvertures_m2 numeric,
  add column if not exists hauteur_source text
    check (hauteur_source is null or hauteur_source in ('bati', 'saisie')),
  add column if not exists pente_source text
    check (pente_source is null or pente_source in ('altitudes', 'saisie')),
  add column if not exists azimut numeric;

comment on column public.metres.ouvertures_m2 is
  'Fenêtres et portes déduites d''une façade. Un ravalement ne se facture pas '
  'sur les vitres.';
comment on column public.metres.pente_source is
  'D''où vient la pente : « altitudes » quand elle est déduite de la BD TOPO, '
  '« saisie » quand l''artisan l''a corrigée. Une estimation et une mesure ne '
  'se valent pas, et on doit pouvoir les distinguer après coup.';

-- Le type « facade » rejoint « surface » et « longueur ».
do $$
begin
  alter table public.metres drop constraint if exists metres_type_check;
  alter table public.metres add constraint metres_type_check
    check (type in ('surface', 'longueur', 'facade'));
end $$;

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
  v_artisan uuid;
  af public.affectations;
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

  -- Sommets nécessaires : trois pour une surface, deux pour une ligne ou une
  -- façade. Le calcul passe par une variable car PL/pgSQL ne sait pas lire un
  -- CASE dans la condition d'un IF — il prend le THEN du CASE pour celui du IF.
  v_min_sommets := 2;
  if p_type = 'surface' then v_min_sommets := 3; end if;
  if jsonb_array_length(coalesce(p_geometrie, '[]'::jsonb)) < v_min_sommets then
    return json_build_object('ok', false, 'error', 'geometrie_insuffisante');
  end if;

  -- Les chiffres viennent d'ici, jamais du navigateur.
  v_ouvertures := greatest(coalesce(p_ouvertures_m2, 0), 0);

  if p_type = 'surface' then
    v_surface   := public.aire_polygone(p_geometrie);
    v_perimetre := public.longueur_ligne(p_geometrie, true);
  else
    v_longueur := public.longueur_ligne(p_geometrie, false);
    if p_type = 'facade' then
      if p_hauteur_m is null or p_hauteur_m <= 0 then
        return json_build_object('ok', false, 'error', 'hauteur_requise');
      end if;
      -- Une façade ne descend pas sous zéro, même si l'artisan déduit plus
      -- d'ouvertures que le mur n'a de surface.
      v_surface := greatest(round(v_longueur * p_hauteur_m - v_ouvertures, 2), 0);
    end if;
  end if;

  v_pente := case when p_pente_pct is null or p_pente_pct < 0 or p_pente_pct > 200
                  then null else p_pente_pct end;
  if p_type = 'surface' and v_surface is not null and v_pente is not null then
    -- Surface réelle = surface projetée / cos(angle de pente). Le cast est
    -- indispensable : cos() renvoie un double precision, et round(double, int)
    -- n'existe pas en PostgreSQL.
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
          nullif(v_ouvertures, 0), p_azimut,
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

-- L'ancienne signature à huit arguments disparaît : deux fonctions de même nom
-- avec des valeurs par défaut rendraient tout appel ambigu.
drop function if exists public.enregistrer_metre_by_token(text, text, text, text, jsonb, numeric, numeric, text);

-- Le contexte remonte les nouveaux champs.
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
               'ouvertures_m2', m.ouvertures_m2, 'azimut', m.azimut,
               'pente_source', m.pente_source, 'hauteur_source', m.hauteur_source,
               'source', m.source, 'created_at', m.created_at)
             order by m.created_at desc), '[]'::json)
        from public.metres m where m.projet_id = p.id)
  );
end
$function$;

revoke execute on function public.metre_contexte_by_token(text, text) from public;
grant execute on function public.metre_contexte_by_token(text, text) to anon, authenticated;
