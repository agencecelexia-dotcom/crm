-- Tout ce qu'on peut savoir d'une maison sans y aller.
--
-- POURQUOI
--
-- L'artisan chiffre à l'aveugle. Or l'État publie gratuitement, sans clé, de
-- quoi remplir la moitié de son devis :
--
--   BDNB      matériau des murs et de la toiture, année, niveaux, emprise
--   DPE ADEME surface habitable, isolation des murs et du toit, étiquette
--   GPU       zonage, et surtout le périmètre des 500 m d'un monument
--   Géorisques aléa argile à l'adresse
--
-- Le périmètre ABF est le plus important : un ravalement à l'intérieur impose
-- des teintes, une déclaration préalable et deux mois de délai. Le découvrir
-- après la signature, c'est le chantier qui dérape. À Paris, rue de Rivoli,
-- 121 servitudes se superposent ; à Lautenbachzell, aucune.
--
-- POURQUOI UN CACHE
--
-- Cinq services interrogés pour une fiche, dont un — la BDNB — limite à dix
-- mille appels. Et ces données ne bougent pas d'un jour à l'autre : une maison
-- de 1966 le restera. On garde donc la réponse, et on ne la rafraîchit que sur
-- demande.
--
-- La fiche est attachée au BÂTIMENT (son identifiant BD TOPO), pas au projet :
-- deux chantiers sur la même maison partagent la même fiche.

create table if not exists public.fiche_batiment (
  id          uuid primary key default gen_random_uuid(),
  -- Identifiant BD TOPO, celui du bâtiment que l'artisan a touché sur la carte.
  cleabs      text not null unique,
  projet_id   uuid references public.projets(id) on delete set null,
  donnees     jsonb not null default '{}'::jsonb,
  recupere_le timestamptz not null default now()
);

create index if not exists idx_fiche_batiment_projet on public.fiche_batiment (projet_id);

alter table public.fiche_batiment enable row level security;

do $$
begin
  drop policy if exists fiche_batiment_lecture on public.fiche_batiment;
  -- Ces données sont publiques par nature : quiconque voit le CRM peut les lire.
  -- L'écriture passe par la clé de service, depuis l'edge function.
  create policy fiche_batiment_lecture on public.fiche_batiment
    for select to authenticated using (true);
end $$;

-- ---------- Lire la fiche depuis l'espace artisan ----------

create or replace function public.fiche_batiment_by_token(p_token text, p_cleabs text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  f public.fiche_batiment;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  select * into f from public.fiche_batiment where cleabs = p_cleabs;
  if f.id is null then
    return json_build_object('ok', true, 'trouvee', false);
  end if;

  return json_build_object('ok', true, 'trouvee', true,
                           'donnees', f.donnees, 'recupere_le', f.recupere_le);
end
$function$;

revoke execute on function public.fiche_batiment_by_token(text, text) from public;
grant execute on function public.fiche_batiment_by_token(text, text) to anon, authenticated;

-- ---------- L'écrire, depuis l'edge function ----------

create or replace function public.enregistrer_fiche_batiment(
  p_cleabs text, p_projet_id uuid, p_donnees jsonb
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

  insert into public.fiche_batiment (cleabs, projet_id, donnees, recupere_le)
  values (btrim(p_cleabs), p_projet_id, coalesce(p_donnees, '{}'::jsonb), now())
  on conflict (cleabs) do update
    set donnees = excluded.donnees,
        recupere_le = now(),
        projet_id = coalesce(public.fiche_batiment.projet_id, excluded.projet_id)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end
$function$;

revoke execute on function public.enregistrer_fiche_batiment(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enregistrer_fiche_batiment(text, uuid, jsonb) to service_role;
