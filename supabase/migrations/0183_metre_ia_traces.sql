-- « Mesurer avec l'IA » : ce que l'IA a TRACÉ sur la photo (emprise, pans, terrasse,
-- barrières, escaliers) et ce que le laser en a mesuré. Les tracés sont en
-- coordonnées de la photo (0 à 1000) : l'artisan pourra les corriger et le serveur
-- remesurer, sans relancer l'IA. `releve` (phase suivante) : le relevé complet qui
-- en est tiré, à la place du relevé automatique.

alter table public.metre_ia
  add column if not exists traces  jsonb,
  add column if not exists mesures jsonb,
  add column if not exists releve  jsonb;

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
    'traces', case when v.statut = 'fait' then v.traces end,
    'mesures', case when v.statut = 'fait' then v.mesures end,
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
