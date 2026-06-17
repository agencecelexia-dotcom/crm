-- 0039 — To-do « À faire » : tâches auto (assignation, relances, encaissement) +
-- tâches manuelles, par priorité, cochables, auto-supprimées 24h après réalisation.
-- Gestion des appels : « pas de réponse » mémorise l'appel et reporte la tâche.

create table if not exists public.taches (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  details text,
  priorite int not null default 2,           -- 1 = haute, 2 = moyenne, 3 = basse
  type text not null default 'manuel',        -- manuel | auto
  categorie text,                             -- assignation | contrat | rdv | devis | commission | appel | autre
  projet_id uuid references public.projets(id) on delete cascade,
  artisan_id uuid references public.artisans(id) on delete set null,
  tel text,                                   -- téléphone à appeler (le cas échéant)
  cle_auto text unique,                       -- idempotence des tâches auto (null pour manuel)
  statut text not null default 'a_faire',     -- a_faire | fait
  done_at timestamptz,
  nb_appels int not null default 0,
  dernier_appel timestamptz,
  rappel_at timestamptz,                       -- report (snooze) après un appel sans réponse
  created_at timestamptz not null default now()
);
create index if not exists idx_taches_statut on public.taches (statut, priorite, created_at);

alter table public.taches enable row level security;
drop policy if exists "taches_auth" on public.taches;
create policy "taches_auth" on public.taches for all to authenticated using (true) with check (true);

-- Génère/rafraîchit les tâches automatiques + nettoie les tâches terminées (+24 h).
create or replace function public.rafraichir_taches()
returns void language plpgsql security definer set search_path = public
as $$
begin
  -- 1) Auto-suppression des tâches faites depuis plus de 24 h
  delete from public.taches where statut = 'fait' and done_at < now() - interval '24 hours';

  -- 2) Ensemble des actions courantes (clé idempotente + contenu)
  create temp table _act on commit drop as
    -- Leads nouveaux sans artisan → assigner
    select 'assign:' || p.id as cle, 'Assigner un artisan' as titre,
           trim(both ' ·' from coalesce(p.client_nom,'') || ' · ' || coalesce(p.client_ville,'') || ' · ' || coalesce(p.metier,'')) as details,
           'assignation' as categorie,
           case when coalesce(p.estimation_interne,0) >= 10000 then 1 else 2 end as priorite,
           p.id as projet_id, null::uuid as artisan_id, null::text as tel
    from public.projets p
    where p.statut = 'nouveau' and p.deleted_at is null
      and not exists (select 1 from public.affectations a where a.projet_id = p.id)
  union all
    -- Contrats non signés → faire signer (appeler l'artisan)
    select 'contrat:' || af.id, 'Faire signer le contrat',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'contrat', 1, p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut not in ('perdu','termine','devis_signe') and p.deleted_at is null
      and ar.contrat_externe = false
      and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
  union all
    -- RDV passés sans suivi → débriefer (appeler l'artisan)
    select 'rdv:' || af.id, 'Débriefer le RDV',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'rdv', 2, p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut = 'rdv_pris' and af.date_rdv is not null and af.date_rdv < now()
      and p.deleted_at is null
      and not exists (select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv)
  union all
    -- Devis envoyés qui traînent (+48 h) → relancer (appeler l'artisan)
    select 'devis:' || af.id, 'Relancer le devis envoyé',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'devis', 2, p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut = 'devis_envoye' and p.deleted_at is null
      and af.updated_at < now() - interval '48 hours'
  union all
    -- Commissions signées non encaissées → encaisser
    select 'commission:' || p.id, 'Encaisser la commission',
           coalesce(p.client_nom,'') || ' · ' || round(coalesce(p.commission,0))::text || ' €',
           'commission', 1, p.id, p.artisan_id,
           (select a2.telephone from public.artisans a2 where a2.id = p.artisan_id)
    from public.projets p
    where p.deleted_at is null and p.montant_devis_signe is not null and p.commission_encaissee = false;

  -- 3) Crée les tâches auto manquantes (sans dupliquer : clé unique)
  insert into public.taches (titre, details, priorite, type, categorie, projet_id, artisan_id, tel, cle_auto)
  select a.titre, a.details, a.priorite, 'auto', a.categorie, a.projet_id, a.artisan_id, a.tel, a.cle
  from _act a
  where not exists (select 1 from public.taches t where t.cle_auto = a.cle);

  -- 4) Supprime les tâches auto « à faire » dont l'action n'a plus lieu d'être
  --    (résolues entre-temps). On garde les « faites » (purge à 24 h) et les manuelles.
  delete from public.taches t
  where t.type = 'auto' and t.statut = 'a_faire'
    and not exists (select 1 from _act a where a.cle = t.cle_auto);
end;
$$;

-- Planification (toutes les 30 min) : génère + nettoie même appli fermée.
create extension if not exists pg_cron with schema extensions;
select cron.unschedule('taches_tick') where exists (select 1 from cron.job where jobname = 'taches_tick');
select cron.schedule('taches_tick', '*/30 * * * *', $$ select public.rafraichir_taches(); $$);

-- Première génération immédiate
select public.rafraichir_taches();
