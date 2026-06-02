-- ============================================================
--  0012 — Nouveaux statuts (à rappeler / en attente) + notes par projet
-- ============================================================

-- ---------- Nouveaux statuts ----------
-- "a_rappeler" : appel manqué / prospect à recontacter
-- "en_attente" : SMS sans réponse / infos insuffisantes
alter table public.projets drop constraint if exists projets_statut_check;
alter table public.projets
  add constraint projets_statut_check check (statut in (
    'nouveau', 'a_rappeler', 'en_attente', 'artisan_assigne',
    'devis_envoye', 'devis_signe', 'perdu'
  ));

-- ---------- Notes rapides par projet ----------
create table if not exists public.projet_notes (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets(id) on delete cascade,
  contenu text not null,
  auteur text,
  created_at timestamptz default now()
);

create index if not exists idx_projet_notes_projet on public.projet_notes (projet_id, created_at desc);

alter table public.projet_notes enable row level security;
drop policy if exists "projet_notes_auth_all" on public.projet_notes;
create policy "projet_notes_auth_all" on public.projet_notes
  for all to authenticated using (true) with check (true);
