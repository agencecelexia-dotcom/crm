-- ============================================================
--  0024 — Multi-assignation : un projet peut être envoyé à PLUSIEURS
--  artisans en parallèle, chacun isolé. Chaque couple artisan↔projet a
--  son propre état (statut, suivi, devis, montants) = table affectations.
-- ============================================================

create table if not exists public.affectations (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets(id) on delete cascade,
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  statut text not null default 'artisan_assigne',
  devis_url text,
  devis_signe_url text,
  montant_devis numeric,
  montant_devis_signe numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (projet_id, artisan_id)
);
create index if not exists idx_affectations_projet on public.affectations (projet_id);
create index if not exists idx_affectations_artisan on public.affectations (artisan_id);

alter table public.affectations enable row level security;
drop policy if exists "affectations_auth_all" on public.affectations;
create policy "affectations_auth_all" on public.affectations
  for all to authenticated using (true) with check (true);

create trigger trg_affectations_updated
  before update on public.affectations
  for each row execute function public.set_updated_at();

-- Le suivi d'un artisan est rattaché à SON affectation (isolation)
alter table public.suivis
  add column if not exists affectation_id uuid references public.affectations(id) on delete cascade;

-- ---------- Migration des assignations existantes ----------
insert into public.affectations (projet_id, artisan_id, statut, devis_url, devis_signe_url, montant_devis, montant_devis_signe)
select p.id, p.artisan_id, p.statut, p.devis_url, p.devis_signe_url, p.montant_devis, p.montant_devis_signe
from public.projets p
where p.artisan_id is not null
on conflict (projet_id, artisan_id) do nothing;

-- Rattacher les suivis existants à l'affectation de leur projet
-- (à ce stade il n'y a qu'une affectation par projet → sans ambiguïté)
update public.suivis s
set affectation_id = a.id
from public.affectations a
where a.projet_id = s.projet_id and s.affectation_id is null;

-- ---------- Bucket public dédié aux devis (lien imprévisible) ----------
insert into storage.buckets (id, name, public)
values ('devis', 'devis', true)
on conflict (id) do nothing;

drop policy if exists "devis_read" on storage.objects;
create policy "devis_read" on storage.objects
  for select using (bucket_id = 'devis');
drop policy if exists "devis_write" on storage.objects;
create policy "devis_write" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'devis');
drop policy if exists "devis_update" on storage.objects;
create policy "devis_update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'devis');
drop policy if exists "devis_delete" on storage.objects;
create policy "devis_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'devis');
