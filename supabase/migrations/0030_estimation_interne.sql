-- 0030 — Estimation INTERNE (potentiel CA) par projet.
-- NON exposée aux RPC artisan (get_espace_artisan / get_mission_by_token) :
-- l'artisan ne voit jamais ce montant. Sert au dashboard (potentiel du pipeline).
alter table public.projets add column if not exists estimation_interne numeric;
comment on column public.projets.estimation_interne is
  'Montant estimé interne (potentiel CA). NON exposé aux RPC artisan.';
