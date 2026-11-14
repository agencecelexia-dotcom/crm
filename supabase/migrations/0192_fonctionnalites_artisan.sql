-- Configuration publique limitée aux rubriques, distincte des secrets app_settings.
create table public.fonctionnalites_artisan (
  cle text primary key check (cle in ('devis', 'metres', 'commissions', 'entreprise', 'aide')),
  active boolean not null,
  updated_at timestamptz not null default now()
);
alter table public.fonctionnalites_artisan enable row level security;
create policy fonctionnalites_lecture on public.fonctionnalites_artisan
  for select to authenticated using (public.est_fondateur());
create policy fonctionnalites_modification on public.fonctionnalites_artisan
  for update to authenticated using (public.est_fondateur()) with check (public.est_fondateur());
grant select, update on public.fonctionnalites_artisan to authenticated;
revoke all on public.fonctionnalites_artisan from anon;
insert into public.fonctionnalites_artisan(cle, active) values
  ('devis', false), ('metres', false), ('commissions', true), ('entreprise', true), ('aide', true);

create function public.fonctionnalites_espace_artisan()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('chantiers', true) || jsonb_object_agg(cle, active)
  from public.fonctionnalites_artisan;
$$;
revoke all on function public.fonctionnalites_espace_artisan() from public;
grant execute on function public.fonctionnalites_espace_artisan() to anon, authenticated;
