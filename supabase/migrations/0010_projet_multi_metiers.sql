-- ============================================================
--  0010 — Un projet peut concerner PLUSIEURS métiers
--  (ex. portail + clôture + toiture pour le même client).
--  On garde `metier` (1er métier, pour compat) + ajoute `metiers text[]`.
-- ============================================================

alter table public.projets
  add column if not exists metiers text[] not null default '{}';

-- Backfill : reprend le métier unique existant dans le tableau
update public.projets
set metiers = array[metier]
where metier is not null
  and (metiers is null or array_length(metiers, 1) is null);

create index if not exists idx_projets_metiers on public.projets using gin (metiers);

-- ---------- get_mission_by_token : renvoie aussi metiers ----------
create or replace function public.get_mission_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  p public.projets;
  a public.artisans;
  c public.contrats;
begin
  select * into p from public.projets where token = p_token;
  if p.id is null then
    return null;
  end if;

  if p.artisan_id is not null then
    select * into a from public.artisans where id = p.artisan_id;
    select * into c from public.contrats
      where artisan_id = p.artisan_id
      order by created_at asc
      limit 1;
  end if;

  return json_build_object(
    'projet', json_build_object(
      'client_nom', p.client_nom,
      'client_telephone', p.client_telephone,
      'client_email', p.client_email,
      'client_adresse', p.client_adresse,
      'client_code_postal', p.client_code_postal,
      'client_ville', p.client_ville,
      'metier', p.metier,
      'metiers', p.metiers,
      'sous_metier', p.sous_metier,
      'description', p.description,
      'budget_estime', p.budget_estime,
      'statut', p.statut,
      'devis_depose', p.devis_url is not null,
      'devis_signe_depose', p.devis_signe_url is not null
    ),
    'artisan', case when a.id is not null
      then json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe)
      else null end,
    'engagement', case when c.id is not null
      then json_build_object(
        'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
        'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
        'signature_data', c.signature_data)
      else null end
  );
end;
$func$;

grant execute on function public.get_mission_by_token(text) to anon, authenticated;
