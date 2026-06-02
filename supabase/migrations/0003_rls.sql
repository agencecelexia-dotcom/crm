-- ============================================================
--  0003 — Row Level Security
--  Politique : tout utilisateur authentifié (les 2 associés) a accès
--  complet en lecture/écriture. Aucun accès anonyme.
-- ============================================================

alter table public.artisans enable row level security;
alter table public.projets  enable row level security;

-- ---------- artisans ----------
drop policy if exists "artisans_authenticated_all" on public.artisans;
create policy "artisans_authenticated_all"
  on public.artisans
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------- projets ----------
drop policy if exists "projets_authenticated_all" on public.projets;
create policy "projets_authenticated_all"
  on public.projets
  for all
  to authenticated
  using (true)
  with check (true);
