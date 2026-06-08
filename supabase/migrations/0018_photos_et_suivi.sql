-- ============================================================
--  0018 — Photos de projet (vues par l'artisan) + suivi/échange
--         agence ↔ artisan (statuts déclarés + notes écrites).
-- ============================================================

-- ---------- Photos du projet ----------
alter table public.projets
  add column if not exists photos text[] not null default '{}'; -- URLs publiques

-- Bucket public dédié aux photos de chantier (non sensible, URLs imprévisibles)
insert into storage.buckets (id, name, public)
values ('projet-photos', 'projet-photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_read" on storage.objects;
create policy "photos_read" on storage.objects
  for select using (bucket_id = 'projet-photos');
drop policy if exists "photos_write" on storage.objects;
create policy "photos_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'projet-photos');
drop policy if exists "photos_delete" on storage.objects;
create policy "photos_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'projet-photos');

-- ---------- Suivi / échanges ----------
create table if not exists public.suivis (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets(id) on delete cascade,
  auteur text not null check (auteur in ('artisan', 'agence')),
  type text not null default 'note' check (type in ('statut', 'note')),
  statut_artisan text,         -- contacte | rdv_pris | devis_envoye | devis_signe | perdu
  message text,
  created_at timestamptz not null default now()
);
create index if not exists idx_suivis_projet on public.suivis (projet_id, created_at);

alter table public.suivis enable row level security;
drop policy if exists "suivis_auth_all" on public.suivis;
create policy "suivis_auth_all" on public.suivis
  for all to authenticated using (true) with check (true);

-- L'artisan (public, via token projet) ajoute un suivi (statut et/ou note).
-- Les jalons clés synchronisent aussi le statut du projet côté agence.
create or replace function public.add_suivi_by_token(
  p_token text, p_statut text default null, p_message text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  pj public.projets;
  v_type text;
begin
  select * into pj from public.projets where token = p_token;
  if pj.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  v_type := case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end;
  insert into public.suivis (projet_id, auteur, type, statut_artisan, message)
  values (pj.id, 'artisan', v_type, nullif(p_statut, ''), nullif(p_message, ''));

  if p_statut in ('devis_envoye', 'devis_signe', 'perdu') then
    update public.projets set statut = p_statut where id = pj.id;
  end if;

  return json_build_object('ok', true);
end;
$func$;

grant execute on function public.add_suivi_by_token(text, text, text) to anon, authenticated;

-- ---------- get_mission_by_token : + photos + suivis ----------
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
  if p.id is null then return null; end if;

  if p.artisan_id is not null then
    select * into a from public.artisans where id = p.artisan_id;
    c := public.ensure_engagement_contrat(p.artisan_id);
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
      'sous_metier', p.sous_metier,
      'description', p.description,
      'budget_estime', p.budget_estime,
      'statut', p.statut,
      'photos', coalesce(p.photos, '{}'),
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
        'signature_data', c.signature_data,
        'apporteur_signature', c.apporteur_signature)
      else null end,
    'suivis', (
      select coalesce(json_agg(json_build_object(
        'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
        'message', s.message, 'created_at', s.created_at
      ) order by s.created_at), '[]'::json)
      from public.suivis s where s.projet_id = p.id
    )
  );
end;
$func$;

grant execute on function public.get_mission_by_token(text) to anon, authenticated;
