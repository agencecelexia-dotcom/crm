-- ============================================================
--  0014 — Purge automatique des projets "perdu" après 48 h
--  Un projet marqué "perdu" est supprimé définitivement 48 h plus tard
--  s'il est toujours "perdu" (sinon le compteur est annulé).
-- ============================================================

-- Date de passage en "perdu" (null si pas perdu)
alter table public.projets add column if not exists perdu_at timestamptz;

-- Trigger : pose/efface perdu_at selon le statut (à l'insertion et à la mise à jour)
create or replace function public.set_perdu_at()
returns trigger
language plpgsql
as $$
begin
  if new.statut = 'perdu'
     and (tg_op = 'INSERT' or old.statut is distinct from 'perdu') then
    new.perdu_at := now();
  elsif new.statut <> 'perdu' then
    new.perdu_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_perdu_at on public.projets;
create trigger trg_set_perdu_at
  before insert or update on public.projets
  for each row execute function public.set_perdu_at();

-- Backfill des projets déjà "perdu" (départ du compteur = leur dernière modif)
update public.projets
set perdu_at = coalesce(updated_at, now())
where statut = 'perdu' and perdu_at is null;

-- ---------- Purge planifiée (pg_cron, toutes les heures) ----------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('purge-projets-perdus');
exception when others then null;
end $$;

select cron.schedule(
  'purge-projets-perdus',
  '0 * * * *',
  $$delete from public.projets
    where statut = 'perdu'
      and perdu_at is not null
      and perdu_at < now() - interval '48 hours'$$
);
