-- ============================================================
--  0029 — Automatisations anti-inaction (P0)
--  - relances : idempotence + timeline (qui a été relancé, quand, pourquoi)
--  - notifications : alertes in-app "à appeler" pour l'agence
--  - traiter_relances() : moteur, lancé par pg_cron toutes les 30 min,
--    garde-fou horaire 8h–20h (Europe/Paris).
-- ============================================================

create table if not exists public.relances (
  id uuid primary key default gen_random_uuid(),
  type text not null,            -- contrat | contrat_escalade | inaction | inaction_escalade | orphelin
  projet_id uuid references public.projets(id) on delete cascade,
  affectation_id uuid references public.affectations(id) on delete cascade,
  cible text not null,           -- artisan | agence
  sent_at timestamptz not null default now()
);
create index if not exists idx_relances_aff on public.relances (affectation_id, type, sent_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'a_appeler',
  titre text not null,
  message text,
  projet_id uuid references public.projets(id) on delete cascade,
  lu boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_lu on public.notifications (lu, created_at desc);

alter table public.relances enable row level security;
alter table public.notifications enable row level security;
drop policy if exists "relances_auth" on public.relances;
create policy "relances_auth" on public.relances for all to authenticated using (true) with check (true);
drop policy if exists "notifications_auth" on public.notifications;
create policy "notifications_auth" on public.notifications for all to authenticated using (true) with check (true);

-- Réglages par défaut (modifiables sans code via app_settings / page Automatisations)
insert into public.app_settings (cle, valeur) values
  ('auto_contrat', 'on'), ('auto_inaction', 'on'), ('auto_orphelin', 'on'),
  ('relance_premier_h', '24'), ('relance_interval_h', '12'), ('relance_escalade_h', '48'),
  ('heure_debut', '8'), ('heure_fin', '20')
on conflict (cle) do nothing;

create or replace function public.cfg(p_cle text, p_defaut text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select valeur from public.app_settings where cle = p_cle), p_defaut);
$$;

-- ---------- Moteur ----------
create or replace function public.traiter_relances()
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  WEBHOOK constant text := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events';
  v_now timestamptz := now();
  v_h int := extract(hour from (v_now at time zone 'Europe/Paris'));
  v_premier numeric := cfg('relance_premier_h','24')::numeric;
  v_interval numeric := cfg('relance_interval_h','12')::numeric;
  v_escalade numeric := cfg('relance_escalade_h','48')::numeric;
  r record; age numeric; last_r timestamptz;
begin
  -- Garde-fou horaire : rien en dehors de [heure_debut, heure_fin[
  if v_h < cfg('heure_debut','8')::int or v_h >= cfg('heure_fin','20')::int then return; end if;

  -- 1) CONTRAT NON SIGNÉ (artisan assigné, contrat ni signé ni externe)
  if cfg('auto_contrat','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.created_at, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut not in ('perdu','termine','devis_signe')
        and ar.contrat_externe = false
        and ar.email is not null
        and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
    loop
      age := extract(epoch from (v_now - r.created_at)) / 3600;
      if age >= v_premier and age < v_escalade then
        select max(sent_at) into last_r from public.relances
          where type='contrat' and affectation_id=r.aff_id and cible='artisan';
        if last_r is null or extract(epoch from (v_now - last_r))/3600 >= v_interval then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','relance_contrat','email',r.email,'artisan_prenom',r.prenom,'artisan_nom',r.nom,
            'metier',r.metier,'client_ville',r.client_ville,
            'lien','https://crm-ci7k.vercel.app/artisan/'||r.a_token));
          insert into public.relances(type,projet_id,affectation_id,cible) values('contrat',r.projet_id,r.aff_id,'artisan');
        end if;
      elsif age >= v_escalade then
        if not exists (select 1 from public.relances where type='contrat_escalade' and affectation_id=r.aff_id) then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','escalade','sujet','contrat',
            'artisan',trim(coalesce(r.prenom,'')||' '||r.nom),'metier',r.metier,'client_ville',r.client_ville,
            'lien','https://crm-ci7k.vercel.app/projets/'||r.projet_id));
          insert into public.relances(type,projet_id,affectation_id,cible) values('contrat_escalade',r.projet_id,r.aff_id,'agence');
          insert into public.notifications(type,titre,message,projet_id) values(
            'a_appeler','À appeler : '||trim(coalesce(r.prenom,'')||' '||r.nom),
            'Contrat non signé depuis '||round(age)||'h — chantier '||coalesce(r.metier,'')||' à '||coalesce(r.client_ville,'?'),
            r.projet_id);
        end if;
      end if;
    end loop;
  end if;

  -- 2) INACTION (artisan signé/externe, statut actif figé)
  if cfg('auto_inaction','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.updated_at, af.statut, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.client_nom, p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut in ('artisan_assigne','contacte','rdv_pris','en_attente')
        and ar.email is not null
        and (ar.contrat_externe = true or exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe'))
    loop
      age := extract(epoch from (v_now - r.updated_at)) / 3600;
      if age >= v_premier and age < v_escalade then
        select max(sent_at) into last_r from public.relances
          where type='inaction' and affectation_id=r.aff_id and cible='artisan';
        if last_r is null or extract(epoch from (v_now - last_r))/3600 >= v_interval then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','relance_inaction','email',r.email,'artisan_prenom',r.prenom,'artisan_nom',r.nom,
            'client_nom',r.client_nom,'statut',r.statut,
            'lien','https://crm-ci7k.vercel.app/artisan/'||r.a_token));
          insert into public.relances(type,projet_id,affectation_id,cible) values('inaction',r.projet_id,r.aff_id,'artisan');
        end if;
      elsif age >= v_escalade then
        if not exists (select 1 from public.relances where type='inaction_escalade' and affectation_id=r.aff_id
                       and sent_at > v_now - interval '24 hours') then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','escalade','sujet','inaction',
            'artisan',trim(coalesce(r.prenom,'')||' '||r.nom),'client_nom',r.client_nom,'statut',r.statut,
            'lien','https://crm-ci7k.vercel.app/projets/'||r.projet_id));
          insert into public.relances(type,projet_id,affectation_id,cible) values('inaction_escalade',r.projet_id,r.aff_id,'agence');
          insert into public.notifications(type,titre,message,projet_id) values(
            'a_appeler','À relancer : '||trim(coalesce(r.prenom,'')||' '||r.nom),
            'Aucune action depuis '||round(age)||'h sur '||coalesce(r.client_nom,'le chantier')||' ('||coalesce(r.statut,'')||')',
            r.projet_id);
        end if;
      end if;
    end loop;
  end if;

  -- 3) LEAD ORPHELIN (digest quotidien à l'agence)
  if cfg('auto_orphelin','on') = 'on' then
    if not exists (select 1 from public.relances where type='orphelin'
                   and sent_at::date = (v_now at time zone 'Europe/Paris')::date) then
      if exists (select 1 from public.projets p where p.statut='nouveau'
                 and not exists (select 1 from public.affectations a where a.projet_id=p.id)
                 and extract(epoch from (v_now - p.created_at))/3600 >= 24) then
        perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
          'event','lead_orphelin',
          'projets', (select jsonb_agg(jsonb_build_object(
              'client',p.client_nom,'ville',p.client_ville,'metier',p.metier,'budget',p.budget_estime
            ) order by p.budget_estime desc nulls last)
            from public.projets p where p.statut='nouveau'
              and not exists (select 1 from public.affectations a where a.projet_id=p.id)
              and extract(epoch from (v_now - p.created_at))/3600 >= 24)));
        insert into public.relances(type,cible) values('orphelin','agence');
      end if;
    end if;
  end if;
end;
$func$;

-- ---------- Planification (toutes les 30 min ; le garde-fou horaire filtre) ----------
create extension if not exists pg_cron with schema extensions;
select cron.unschedule('relances_tick') where exists (select 1 from cron.job where jobname='relances_tick');
select cron.schedule('relances_tick', '*/30 * * * *', $$ select public.traiter_relances(); $$);
