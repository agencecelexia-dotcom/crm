-- La maison retenue garde aussi un point, pour être relue vite.
--
-- Interroger la BD TOPO par identifiant (`cleabs IN (…)`) prend 25 secondes :
-- le champ n'est pas indexé côté IGN. Autour d'un point, la requête prend une
-- seconde (index spatial). On garde donc un point situé DANS la maison — celui
-- du RNB, ou un sommet du contour — à côté de son identifiant.

alter table public.projets
  add column if not exists batiment_lon numeric(10,7),
  add column if not exists batiment_lat numeric(10,7);

drop function if exists public.retenir_batiment_by_token(text, text, text, boolean);
drop function if exists public.enregistrer_batiment_projet(uuid, text, text, text, numeric);

create or replace function public.retenir_batiment_by_token(
  p_token text, p_affectation_token text, p_cleabs text, p_confirme boolean default true,
  p_lon numeric default null, p_lat numeric default null
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
  if public.acces_par_jeton(p_affectation_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_affectation_token, true));
  end if;
  select id into v_artisan from public.artisans where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  select * into af from public.affectations where token = p_affectation_token;
  if af.id is null or af.artisan_id <> v_artisan then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;
  if p_cleabs is null or p_cleabs !~ '^BATIMENT[0-9]{16}$' then
    return json_build_object('ok', false, 'error', 'batiment_invalide');
  end if;
  -- Un point en France métropolitaine ou d'outre-mer, sinon on l'ignore.
  if p_lon is not null and (p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90) then
    p_lon := null; p_lat := null;
  end if;

  update public.projets
     set batiment_source = case when batiment_cleabs is distinct from p_cleabs
                                then 'artisan' else batiment_source end,
         batiment_cleabs = p_cleabs,
         batiment_lon = coalesce(p_lon, case when batiment_cleabs = p_cleabs then batiment_lon end),
         batiment_lat = coalesce(p_lat, case when batiment_cleabs = p_cleabs then batiment_lat end),
         batiment_confirme_at = case when coalesce(p_confirme, true) then now()
                                     else batiment_confirme_at end
   where id = af.projet_id;

  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.retenir_batiment_by_token(text, text, text, boolean, numeric, numeric) from public;
grant execute on function public.retenir_batiment_by_token(text, text, text, boolean, numeric, numeric) to anon, authenticated;

create or replace function public.enregistrer_batiment_projet(
  p_projet_id uuid, p_cleabs text, p_source text, p_adresse text, p_score numeric,
  p_lon numeric default null, p_lat numeric default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'error', 'reserve_service');
  end if;
  -- Une maison CONFIRMÉE par un humain, ou choisie par l'artisan, ne se
  -- remplace pas par un calcul : c'est lui qui a vu la maison.
  update public.projets
     set batiment_cleabs = coalesce(p_cleabs, batiment_cleabs),
         batiment_source = coalesce(p_source, batiment_source),
         batiment_lon = coalesce(p_lon, batiment_lon),
         batiment_lat = coalesce(p_lat, batiment_lat),
         adresse_retrouvee = p_adresse,
         adresse_score = p_score,
         batiment_calcule_le = now()
   where id = p_projet_id
     and batiment_confirme_at is null
     and coalesce(batiment_source, '') not in ('artisan', 'agence');
  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.enregistrer_batiment_projet(uuid, text, text, text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.enregistrer_batiment_projet(uuid, text, text, text, numeric, numeric, numeric) to service_role;

-- Le contexte du métré renvoie ce point.
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
               'source', m.source, 'created_at', m.created_at)
             order by m.created_at desc), '[]'::json)
        from public.metres m where m.projet_id = p.id and m.artisan_id = v_artisan)
  );
end
$function$

;
