-- ============================================================
--  0013 — Bloc-notes général (non rattaché à un projet)
--  Espace de prise de notes rapide pour les associés (Thomas / Antoine).
-- ============================================================

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  contenu text not null,
  auteur text,
  created_at timestamptz default now()
);

create index if not exists idx_notes_created on public.notes (created_at desc);

alter table public.notes enable row level security;
drop policy if exists "notes_auth_all" on public.notes;
create policy "notes_auth_all" on public.notes
  for all to authenticated using (true) with check (true);
