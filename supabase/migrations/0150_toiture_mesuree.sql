-- La pente d'un toit, mesurée au LiDAR — et gardée.
--
-- POURQUOI UN CACHE
--
-- Chaque mesure coûte DEUX images à l'IGN, quelques centaines de kilo-octets,
-- et deux à cinq secondes. Or un toit ne bouge pas : la pente mesurée sur le
-- vol de 2022 vaut encore demain. Et comme le service étrangle par l'adresse
-- IP, chaque appel évité protège les suivants.
--
-- Le cache est attaché au BÂTIMENT, pas au projet — même raison que pour la
-- fiche : deux chantiers sur la même maison partagent la même toiture.
--
-- On garde aussi les ÉCHECS. « Ce bâtiment est hors couverture LiDAR » est une
-- réponse utile, et la refaire douze fois ne la changera pas : la couverture
-- n'évolue qu'au rythme des vols, plusieurs mois. La colonne `couvert` le dit,
-- et `mesure_le` permettra de réinterroger les trous quand ils se combleront.

create table if not exists public.toiture_mesuree (
  id           uuid primary key default gen_random_uuid(),
  -- Identifiant BD TOPO du bâtiment touché sur la carte.
  cleabs       text not null unique,
  -- false = hors couverture LiDAR, ou trop peu de toit pour conclure.
  couvert      boolean not null default false,
  motif        text,
  -- Pente médiane des pixels de toiture, en pourcentage.
  pente_pct    numeric(5,1),
  -- Demi-écart interquartile : la dispersion des pixels EST l'incertitude.
  -- Trois points sur un toit simple, douze sur un toit à plusieurs volumes.
  incertitude  numeric(5,1),
  pixels       integer,
  -- Les versants : orientation et part, dans l'ordre décroissant.
  versants     jsonb not null default '[]'::jsonb,
  source       text,
  mesure_le    timestamptz not null default now()
);

alter table public.toiture_mesuree enable row level security;

do $$
begin
  drop policy if exists toiture_mesuree_lecture on public.toiture_mesuree;
  -- Donnée publique par nature : elle vient d'un service ouvert de l'État.
  -- L'écriture passe par la clé de service, depuis l'edge function.
  create policy toiture_mesuree_lecture on public.toiture_mesuree
    for select to authenticated using (true);
end $$;

-- ---------- Lire depuis l'espace artisan ----------

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
    'mesure_le', v.mesure_le
  );
end
$function$;

grant execute on function public.toiture_by_token(text, text) to anon, authenticated, service_role;

-- ---------- Écrire depuis l'edge function ----------

create or replace function public.enregistrer_toiture(
  p_cleabs text, p_couvert boolean, p_motif text, p_pente numeric,
  p_incertitude numeric, p_pixels integer, p_versants jsonb, p_source text
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

  -- Une pente au-delà de 300 % n'est pas un toit mais une falaise ou un
  -- artefact : on refuse de la garder plutôt que de la servir comme un fait.
  if p_couvert and (p_pente is null or p_pente < 0 or p_pente > 300) then
    return json_build_object('ok', false, 'error', 'pente_hors_bornes');
  end if;

  insert into public.toiture_mesuree
    (cleabs, couvert, motif, pente_pct, incertitude, pixels, versants, source, mesure_le)
  values
    (btrim(p_cleabs), coalesce(p_couvert, false), p_motif, p_pente,
     p_incertitude, p_pixels, coalesce(p_versants, '[]'::jsonb), p_source, now())
  on conflict (cleabs) do update
    set couvert = excluded.couvert,
        motif = excluded.motif,
        pente_pct = excluded.pente_pct,
        incertitude = excluded.incertitude,
        pixels = excluded.pixels,
        versants = excluded.versants,
        source = excluded.source,
        mesure_le = now()
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end
$function$;

revoke execute on function public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.enregistrer_toiture(text, boolean, text, numeric, numeric, integer, jsonb, text)
  to service_role;

-- ---------- La pente mesurée entre dans les métrés ----------

-- `pente_source` valait « altitudes » ou « saisie ». Il lui faut « lidar » :
-- sans quoi une mesure à cinquante centimètres serait enregistrée sous le même
-- nom qu'une déduction à ±30 points, et plus personne ne saurait laquelle.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'metres' and column_name = 'pente_source'
  ) then
    alter table public.metres drop constraint if exists metres_pente_source_check;
    alter table public.metres add constraint metres_pente_source_check
      check (pente_source is null or pente_source in ('altitudes', 'saisie', 'lidar', 'photogrammetrie'));
  end if;
end $$;
