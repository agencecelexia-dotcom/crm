-- « Mesurer avec l'IA » : la lecture d'une maison par l'IA, gardée par bâtiment.
--
-- L'IA ne mesure pas : elle nomme et rattache (volumes, terrasses, escaliers)
-- ce que le LiDAR a mesuré, et l'écran en tire un modèle 3D. Ce que la fonction
-- `metre-ia` garde ici : la scène lue, les niveaux du terrain, ce que les
-- mesures ont contredit, le coût. Un enregistrement par maison (comme
-- `releve_batiment`), refait à la demande de l'artisan seulement.
--
-- La lecture est LANCÉE PAR UN BOUTON, jamais automatiquement : elle n'a donc
-- pas d'interrupteur dans Paramètres › Automatisations. Si un jour la
-- pré-mesure devait la lancer, il lui en faudrait un (`auto_metre_ia`).

create table if not exists public.metre_ia (
  cleabs      text primary key,
  -- Version du calcul : une lecture plus ancienne est refaite à la demande.
  version     integer not null default 1,
  statut      text not null check (statut in ('en_cours', 'fait', 'echec')),
  -- Où en est la lecture, pour l'écran (« L'IA analyse la scène… »).
  etape       text,
  etapes      jsonb not null default '[]'::jsonb,
  -- La scène lue (volumes, escaliers, doutes), les niveaux du terrain, ce que les mesures ont contredit.
  scene       jsonb,
  niveaux     jsonb,
  verif       jsonb,
  -- Modèle appelé, jetons, durées : ce que la lecture a coûté.
  modele      text,
  cout        jsonb,
  motif       text,
  demande_par text,
  demande_le  timestamptz not null default now(),
  fait_le     timestamptz
);

alter table public.metre_ia enable row level security;

do $$
begin
  drop policy if exists metre_ia_lecture on public.metre_ia;
  -- Une lecture de la maison, sans personne dedans : l'agence la lit. L'écriture
  -- passe par la clé de service.
  create policy metre_ia_lecture on public.metre_ia for select to authenticated using (true);
end $$;

-- ---------- Lire depuis l'espace artisan ----------

create or replace function public.metre_ia_by_token(p_token text, p_cleabs text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  v         public.metre_ia%rowtype;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null limit 1;
  if v_artisan is null then
    return json_build_object('trouve', false, 'error', 'token_invalide');
  end if;
  select * into v from public.metre_ia where cleabs = btrim(coalesce(p_cleabs, ''));
  if not found then
    return json_build_object('trouve', false);
  end if;
  return json_build_object(
    'trouve', true,
    'statut', v.statut,
    'version', v.version,
    'etape', v.etape,
    'etapes', v.etapes,
    'scene', case when v.statut = 'fait' then v.scene end,
    'niveaux', case when v.statut = 'fait' then v.niveaux end,
    'verif', case when v.statut = 'fait' then v.verif end,
    'modele', v.modele,
    'motif', v.motif,
    'demande_le', v.demande_le,
    'fait_le', v.fait_le
  );
end
$function$;

revoke execute on function public.metre_ia_by_token(text, text) from public;
grant execute on function public.metre_ia_by_token(text, text) to anon, authenticated, service_role;
