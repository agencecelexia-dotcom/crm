-- Le relevé d'une maison dans le nuage de points LiDAR HD — et gardé.
--
-- CE QU'IL APPORTE
--
-- Le contour du cadastre recalé sur le toit (il est placé à ±3 à 5 m), le
-- débord mesuré côté par côté, le toit pan par pan (la surface est leur
-- somme), les façades avec leur silhouette. Calcul : `_releve.ts`.
--
-- POURQUOI UN CACHE PAR BÂTIMENT
--
-- L'IGN met 20 à 75 secondes à servir les points d'une maison, et étrangle
-- par adresse. Or un toit ne bouge pas : deux chantiers sur la même maison, ou
-- la pré-mesure puis l'artisan, lisent le même relevé. Les échecs sont gardés
-- aussi (« hors couverture » ne changera pas d'ici demain), avec un nombre
-- d'essais pour ne pas s'acharner.
--
-- La fonction `releve-lidar` répond « en cours » et calcule après sa réponse ;
-- `reserver_releve` garantit qu'un seul calcul tourne par maison.

create table if not exists public.releve_batiment (
  id           uuid primary key default gen_random_uuid(),
  -- Identifiant BD TOPO du bâtiment.
  cleabs       text not null unique,
  -- Version du calcul : un relevé plus ancien est refait.
  version      integer not null default 1,
  statut       text not null
               check (statut in ('en_cours', 'fait', 'hors_couverture', 'introuvable', 'echec')),
  -- maison_absente (aucun toit sous le contour), hors_couverture, ou l'erreur.
  motif        text,
  confiance    text check (confiance is null or confiance in ('haute', 'moyenne', 'basse')),
  -- Le relevé complet, tel que l'écran l'affiche (_releve.ts, type Releve).
  releve       jsonb,
  -- Quelques chiffres hors du JSON, pour les requêtes et le suivi.
  toit_vrai_m2 numeric check (toit_vrai_m2 is null or toit_vrai_m2 between 0 and 20000),
  toit_plan_m2 numeric check (toit_plan_m2 is null or toit_plan_m2 between 0 and 20000),
  recalage_m   numeric check (recalage_m is null or recalage_m between 0 and 10),
  vol          date,
  -- Coût de la lecture : octets lus à l'IGN, durée totale.
  octets       integer,
  duree_ms     integer,
  -- L'extrait de points est-il au stockage (releves/<cleabs>/v<version>/) ?
  extrait      boolean not null default false,
  essais       integer not null default 0,
  demande_le   timestamptz not null default now(),
  fait_le      timestamptz
);

alter table public.releve_batiment enable row level security;

do $$
begin
  drop policy if exists releve_batiment_lecture on public.releve_batiment;
  -- Donnée publique par nature (services ouverts de l'IGN), sans personne
  -- dedans : l'agence la lit. L'écriture passe par la clé de service.
  create policy releve_batiment_lecture on public.releve_batiment
    for select to authenticated using (true);
end $$;

-- Les extraits de points : privés, lus et écrits par les seules fonctions.
insert into storage.buckets (id, name, public)
values ('releves', 'releves', false)
on conflict (id) do nothing;

-- ---------- Lire depuis l'espace artisan ----------

create or replace function public.releve_by_token(p_token text, p_cleabs text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  v         public.releve_batiment%rowtype;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null limit 1;
  if v_artisan is null then
    return json_build_object('trouve', false, 'error', 'token_invalide');
  end if;
  if coalesce(btrim(p_cleabs), '') = '' then
    return json_build_object('trouve', false);
  end if;

  select * into v from public.releve_batiment where cleabs = btrim(p_cleabs);
  if not found then
    return json_build_object('trouve', false);
  end if;

  return json_build_object(
    'trouve', true,
    'id', v.id,
    'statut', v.statut,
    'version', v.version,
    'motif', v.motif,
    'confiance', v.confiance,
    'releve', case when v.statut = 'fait' then v.releve end,
    'essais', v.essais,
    'demande_le', v.demande_le,
    'fait_le', v.fait_le
  );
end
$function$;

revoke execute on function public.releve_by_token(text, text) from public;
grant execute on function public.releve_by_token(text, text) to anon, authenticated, service_role;

-- ---------- Réserver un calcul (service) ----------
--
-- Vrai si l'appelant doit relever maintenant : la maison n'a pas de relevé,
-- ou il est d'une version antérieure, ou le dernier calcul a échoué (ou s'est
-- perdu : la fonction ne vit pas six minutes) il y a plus d'une heure — un
-- jour après trois essais. Un « hors couverture » se réessaie après trois
-- mois : l'IGN publie de nouvelles dalles au fil des vols.

create or replace function public.reserver_releve(p_cleabs text, p_version integer)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v public.releve_batiment%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;
  if coalesce(btrim(p_cleabs), '') = '' or p_version is null or p_version < 1 then
    return false;
  end if;

  insert into public.releve_batiment (cleabs, version, statut, essais, demande_le)
  values (btrim(p_cleabs), p_version, 'en_cours', 1, now())
  on conflict (cleabs) do nothing;
  if found then
    return true;
  end if;

  select * into v from public.releve_batiment where cleabs = btrim(p_cleabs) for update;
  -- Un calcul en cours (ou perdu depuis moins de six minutes).
  if v.statut = 'en_cours' and v.demande_le > now() - interval '6 minutes' then
    return false;
  end if;
  if v.version >= p_version then
    if v.statut in ('fait', 'introuvable') then
      return false;
    end if;
    if v.statut = 'hors_couverture' and coalesce(v.fait_le, v.demande_le) > now() - interval '90 days' then
      return false;
    end if;
    -- Un échec, ou un calcul perdu en route : une fois l'heure, une fois le
    -- jour après trois.
    if v.statut in ('echec', 'en_cours')
       and v.demande_le > now() - (case when v.essais >= 3 then interval '1 day' else interval '1 hour' end) then
      return false;
    end if;
  end if;

  update public.releve_batiment
     set statut = 'en_cours',
         version = p_version,
         essais = case when v.version < p_version then 1
                       when v.statut in ('echec', 'en_cours') then v.essais + 1
                       else 1 end,
         demande_le = now()
   where id = v.id;
  return true;
end
$function$;

revoke execute on function public.reserver_releve(text, integer) from public, anon, authenticated;
grant execute on function public.reserver_releve(text, integer) to service_role;

-- ---------- Enregistrer un relevé (service) ----------

create or replace function public.enregistrer_releve(
  p_cleabs text,
  p_version integer,
  p_statut text,
  p_motif text default null,
  p_confiance text default null,
  p_releve jsonb default null,
  p_toit_vrai numeric default null,
  p_toit_plan numeric default null,
  p_recalage numeric default null,
  p_vol date default null,
  p_octets integer default null,
  p_duree_ms integer default null,
  p_extrait boolean default false
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
  if p_statut not in ('fait', 'hors_couverture', 'introuvable', 'echec') then
    return json_build_object('ok', false, 'error', 'statut_invalide');
  end if;
  if p_statut = 'fait' and (p_releve is null or jsonb_typeof(p_releve -> 'pans') <> 'array') then
    return json_build_object('ok', false, 'error', 'releve_requis');
  end if;
  -- Une maison de 20 000 m² de toit, ou recalée de plus de 10 m, n'est pas
  -- une mesure : on ne garde pas le chiffre.
  if p_toit_vrai is not null and (p_toit_vrai < 0 or p_toit_vrai > 20000) then
    return json_build_object('ok', false, 'error', 'surface_hors_bornes');
  end if;
  if p_recalage is not null and (p_recalage < 0 or p_recalage > 10) then
    return json_build_object('ok', false, 'error', 'recalage_hors_bornes');
  end if;

  insert into public.releve_batiment
    (cleabs, version, statut, motif, confiance, releve, toit_vrai_m2, toit_plan_m2,
     recalage_m, vol, octets, duree_ms, extrait, essais, demande_le, fait_le)
  values
    (btrim(p_cleabs), p_version, p_statut, p_motif, p_confiance,
     case when p_statut = 'fait' then p_releve end,
     p_toit_vrai, p_toit_plan, p_recalage, p_vol, p_octets, p_duree_ms,
     coalesce(p_extrait, false), 1, now(), now())
  on conflict (cleabs) do update
    set version = excluded.version, statut = excluded.statut, motif = excluded.motif,
        confiance = excluded.confiance, releve = excluded.releve,
        toit_vrai_m2 = excluded.toit_vrai_m2, toit_plan_m2 = excluded.toit_plan_m2,
        recalage_m = excluded.recalage_m, vol = excluded.vol, octets = excluded.octets,
        duree_ms = excluded.duree_ms, extrait = excluded.extrait, fait_le = now()
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end
$function$;

revoke execute on function public.enregistrer_releve(text, integer, text, text, text, jsonb, numeric, numeric, numeric, date, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.enregistrer_releve(text, integer, text, text, text, jsonb, numeric, numeric, numeric, date, integer, integer, boolean)
  to service_role;
