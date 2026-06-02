-- ============================================================
--  0005 — Sous-métiers (précision du savoir-faire)
--  artisans.sous_metiers : ce que l'artisan fait exactement
--  projets.sous_metier   : sous-métier précis demandé (optionnel)
-- ============================================================

alter table public.artisans
  add column if not exists sous_metiers text[] not null default '{}';

alter table public.projets
  add column if not exists sous_metier text;

create index if not exists idx_artisans_sous_metiers
  on public.artisans using gin (sous_metiers);
