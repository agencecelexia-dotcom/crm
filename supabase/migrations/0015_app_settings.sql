-- ------------------------------------------------------------
--  Réglages applicatifs (singleton clé/valeur).
--  Sert notamment à stocker la signature de l'apporteur (CELEXIA),
--  saisie une seule fois côté admin et apposée sur chaque contrat.
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  cle text primary key,
  valeur text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Accès complet aux utilisateurs authentifiés (les 2 associés). Pas d'accès anon.
drop policy if exists "app_settings_auth_all" on public.app_settings;
create policy "app_settings_auth_all" on public.app_settings
  for all to authenticated using (true) with check (true);
