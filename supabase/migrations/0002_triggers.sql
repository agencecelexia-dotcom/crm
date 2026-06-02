-- ============================================================
--  0002 — Trigger updated_at = now() à chaque UPDATE
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_artisans_updated_at on public.artisans;
create trigger trg_artisans_updated_at
  before update on public.artisans
  for each row execute function public.set_updated_at();

drop trigger if exists trg_projets_updated_at on public.projets;
create trigger trg_projets_updated_at
  before update on public.projets
  for each row execute function public.set_updated_at();
