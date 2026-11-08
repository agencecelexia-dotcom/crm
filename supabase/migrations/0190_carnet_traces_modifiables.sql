-- Modifier le même tracé manuel, sans nouvelle mesure ni analyse distante.
create or replace function public.modifier_trace_by_token(
  p_token text, p_affectation_token text, p_id uuid, p_nom text,
  p_geometrie jsonb, p_nom_initial text, p_geometrie_initiale jsonb
) returns json language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  a uuid; af public.affectations; m public.metres;
  erreur text; sommet jsonb; n int; distincts int;
  surface numeric; distance numeric; v_nom text := btrim(p_nom);
begin
  select id into a from public.artisans where token = p_token and ecarte_at is null;
  if a is null then return json_build_object('ok', false, 'error', 'token_invalide'); end if;
  select * into af from public.affectations where token = p_affectation_token;
  if af.id is null or af.artisan_id <> a then return json_build_object('ok', false, 'error', 'chantier_introuvable'); end if;
  -- Même ordre que les autres mutations de suivi : projet, affectation, mesure.
  perform 1 from public.projets where id = af.projet_id for update;
  select * into af from public.affectations where token = p_affectation_token for update;
  if af.id is null or af.artisan_id <> a then return json_build_object('ok', false, 'error', 'chantier_introuvable'); end if;
  erreur := public.acces_suivi_par_jeton(p_affectation_token);
  if erreur is not null then return json_build_object('ok', false, 'error', erreur); end if;
  select * into m from public.metres where id = p_id and artisan_id = a
    and projet_id = af.projet_id and affectation_id = af.id for update;
  if m.id is null then return json_build_object('ok', false, 'error', 'trace_introuvable'); end if;
  -- Une toiture calculée/LiDAR ne devient jamais une surface plane par édition.
  if m.source <> 'dessin' or m.type not in ('surface', 'longueur')
     or m.releve_id is not null or m.pente_pct is not null or m.hauteur_m is not null
     or (m.surface_reelle_m2 is not null and m.surface_reelle_m2 is distinct from m.surface_m2) then
    return json_build_object('ok', false, 'error', 'trace_non_modifiable');
  end if;
  if v_nom is null or length(v_nom) = 0 or length(v_nom) > 120 then
    return json_build_object('ok', false, 'error', 'nom_invalide');
  end if;
  if p_geometrie is null or jsonb_typeof(p_geometrie) <> 'array' then
    return json_build_object('ok', false, 'error', 'geometrie_invalide');
  end if;
  n := jsonb_array_length(p_geometrie);
  if n < (case when m.type = 'surface' then 3 else 2 end) then
    return json_build_object('ok', false, 'error', 'geometrie_insuffisante');
  end if;
  if n > 500 then return json_build_object('ok', false, 'error', 'trace_demesure'); end if;
  for sommet in select value from jsonb_array_elements(p_geometrie) loop
    if jsonb_typeof(sommet) <> 'array' then return json_build_object('ok', false, 'error', 'geometrie_invalide'); end if;
    if jsonb_array_length(sommet) <> 2 or jsonb_typeof(sommet->0) <> 'number' or jsonb_typeof(sommet->1) <> 'number' then
      return json_build_object('ok', false, 'error', 'geometrie_invalide');
    end if;
    if (sommet->>0)::numeric not between -180 and 180 or (sommet->>1)::numeric not between -90 and 90 then
      return json_build_object('ok', false, 'error', 'geometrie_invalide');
    end if;
  end loop;
  select count(distinct value) into distincts from jsonb_array_elements(p_geometrie);
  if distincts < (case when m.type = 'surface' then 3 else 2 end) then
    return json_build_object('ok', false, 'error', 'geometrie_insuffisante');
  end if;
  distance := public.longueur_ligne(p_geometrie, m.type = 'surface');
  surface := case when m.type = 'surface' then public.aire_polygone(p_geometrie) end;
  if distance > 2000 then return json_build_object('ok', false, 'error', 'trace_demesure'); end if;
  if distance <= 0 or (m.type = 'surface' and surface <= 0) then
    return json_build_object('ok', false, 'error', 'geometrie_insuffisante');
  end if;
  -- Réessai identique après perte de connexion : aucun doublon, même réponse.
  if m.nom = v_nom and m.geometrie = p_geometrie then return json_build_object('ok', true, 'metre', (to_jsonb(m) || jsonb_build_object('modifiable_trace', true))); end if;
  if m.nom is distinct from p_nom_initial or m.geometrie is distinct from p_geometrie_initiale then
    return json_build_object('ok', false, 'error', 'trace_modifie');
  end if;
  update public.metres set nom = v_nom, geometrie = p_geometrie,
    surface_m2 = surface, perimetre_m = case when m.type = 'surface' then distance end,
    surface_reelle_m2 = case when m.surface_reelle_m2 is not null then surface end,
    longueur_m = case when m.type = 'longueur' then distance end
    where id = m.id returning * into m;
  return json_build_object('ok', true, 'metre', (to_jsonb(m) || jsonb_build_object('modifiable_trace', true)));
end;
$function$;
revoke execute on function public.modifier_trace_by_token(text,text,uuid,text,jsonb,text,jsonb) from public;
grant execute on function public.modifier_trace_by_token(text,text,uuid,text,jsonb,text,jsonb) to anon, authenticated;


-- Capacité calculée sur la ligne complète : le navigateur ne devine pas les droits.
CREATE OR REPLACE FUNCTION public.metre_contexte_by_token(p_token text, p_affectation_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'metiers', p.metiers,
    -- La maison retenue pour ce chantier (0168) : la même pour l'agence et
    -- pour chaque artisan. L'adresse retrouvée suit la règle de l'adresse du
    -- client : visible seulement une fois le contrat signé.
    'batiment_cleabs', p.batiment_cleabs,
    'batiment_source', p.batiment_source,
    'batiment_confirme_at', p.batiment_confirme_at,
    'batiment_lon', p.batiment_lon,
    'batiment_lat', p.batiment_lat,
    'adresse_score', p.adresse_score,
    'adresse_retrouvee', case when p.id is not null
       and exists (select 1 from public.contrats c
                    where c.artisan_id = v_artisan and c.signed_at is not null)
      then p.adresse_retrouvee end,
    'metres', (
      select coalesce(json_agg(json_build_object(
               'id', m.id, 'nom', m.nom, 'type', m.type, 'geometrie', m.geometrie,
               'surface_m2', m.surface_m2, 'perimetre_m', m.perimetre_m,
               'longueur_m', m.longueur_m, 'hauteur_m', m.hauteur_m,
               'pente_pct', m.pente_pct, 'surface_reelle_m2', m.surface_reelle_m2,
               'ouvertures_m2', m.ouvertures_m2, 'azimut', m.azimut,
               'pente_source', m.pente_source, 'hauteur_source', m.hauteur_source,
               'source', m.source, 'created_at', m.created_at,
               'releve_id', m.releve_id,
               'modifiable_trace', coalesce(
                 m.affectation_id = af.id and public.acces_suivi_par_jeton(p_affectation_token) is null
                 and m.source = 'dessin' and m.type in ('surface', 'longueur')
                 and m.releve_id is null and m.pente_pct is null and m.hauteur_m is null
                 and (m.surface_reelle_m2 is null or m.surface_reelle_m2 = m.surface_m2), false))
             order by m.created_at desc), '[]'::json)
        from public.metres m where m.projet_id = p.id and m.artisan_id = v_artisan)
  );
end
$function$

;
