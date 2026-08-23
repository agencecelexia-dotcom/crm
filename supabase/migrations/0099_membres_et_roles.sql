-- Socle des rôles : qui accède au CRM, et avec quel périmètre.
--
-- Jusqu'ici le CRM n'avait aucune notion de rôle : deux comptes, une policy
-- `using (true)` sur chacune des 15 tables, donc tout le monde voyait tout.
-- C'était cohérent pour deux associés. Ça ne l'est plus dès qu'un commercial
-- entre : il doit pouvoir saisir et suivre SES leads, sans accéder aux
-- commissions de l'agence ni aux dossiers de ses collègues.
--
-- Cette migration pose la table et les fonctions. La réécriture des policies
-- est faite séparément (0100) pour que chaque étape reste vérifiable seule.

create table if not exists public.membres (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  role              text not null check (role in ('fondateur', 'commercial')),
  nom               text not null,
  email             text,
  actif             boolean not null default true,

  -- Part de la commission agence reversée au commercial. Modifiable par
  -- personne : un commercial recruté à 12 % ne doit pas dépendre d'un code
  -- en dur.
  taux_retrocession numeric(4,3) not null default 0.100
                    check (taux_retrocession >= 0 and taux_retrocession <= 1),

  -- Droits activables individuellement depuis l'écran Équipe. Le défaut est
  -- le périmètre minimal d'un commercial : saisir des leads et les attribuer.
  peut_creer_lead        boolean not null default true,
  peut_attribuer         boolean not null default true,
  peut_creer_artisan     boolean not null default false,
  peut_voir_commissions  boolean not null default false,

  invite_par        uuid references auth.users(id),
  invite_at         timestamptz not null default now(),
  active_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.membres is
  'Personnes ayant accès au CRM. Le rôle détermine le périmètre : un fondateur voit tout, un commercial ne voit que ses propres leads.';
comment on column public.membres.taux_retrocession is
  'Part de la commission AGENCE reversée au commercial, versée à l''encaissement et non à la signature.';

create index if not exists idx_membres_user on public.membres(user_id);
create index if not exists idx_membres_role on public.membres(role) where actif;

drop trigger if exists trg_membres_updated on public.membres;
create trigger trg_membres_updated before update on public.membres
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Fonctions d'appui.
--
-- `security definer` + `stable` : elles sont appelées dans les prédicats des
-- policies, donc des milliers de fois par requête. `stable` permet à Postgres
-- de ne les évaluer qu'une fois par requête ; `security definer` évite la
-- récursion infinie (lire `membres` pour décider qui peut lire `membres`).

create or replace function public.est_fondateur()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.membres
     where user_id = auth.uid() and role = 'fondateur' and actif
  );
$$;

comment on function public.est_fondateur() is
  'Vrai si le compte courant est fondateur. Utilisée dans les policies RLS.';

create or replace function public.mon_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.membres where user_id = auth.uid() and actif;
$$;

-- Colonne d'assignation : un chantier perdu par Batryx peut être confié à un
-- commercial pour reprise, sans qu'il en soit l'auteur.
alter table public.projets add column if not exists assigne_a uuid references auth.users(id);
comment on column public.projets.assigne_a is
  'Commercial chargé de reprendre ce chantier. Distinct de created_by, qui reste l''auteur de la saisie.';
create index if not exists idx_projets_assigne on public.projets(assigne_a) where assigne_a is not null;

/**
 * Projets visibles par le compte courant.
 *
 * Fondateur : tout. Commercial : ce qu'il a créé, plus ce qui lui a été
 * explicitement confié à réattribuer (`assigne_a`).
 *
 * Renvoie un `setof uuid` pour être utilisable en `in (select …)` dans les
 * policies des tables filles, qui n'ont pas de `created_by`.
 */
create or replace function public.mes_projets()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id from public.projets p
   where public.est_fondateur()
      or p.created_by = auth.uid()
      or p.assigne_a = auth.uid();
$$;

comment on function public.mes_projets() is
  'Projets visibles par le compte courant. Fondateur : tous. Commercial : les siens et ceux qu''on lui a confiés.';

revoke execute on function public.est_fondateur() from public, anon;
revoke execute on function public.mon_role() from public, anon;
revoke execute on function public.mes_projets() from public, anon;
grant execute on function public.est_fondateur() to authenticated;
grant execute on function public.mon_role() to authenticated;
grant execute on function public.mes_projets() to authenticated;

-- ---------------------------------------------------------------------------
-- Amorçage : les deux comptes existants deviennent fondateurs.
--
-- Sans cette étape, la migration 0100 rendrait le CRM inaccessible à tous :
-- personne ne serait fondateur, et `mes_projets()` ne renverrait rien.

insert into public.membres (user_id, role, nom, email, active_at)
select u.id, 'fondateur',
       coalesce(split_part(u.email, '@', 1), 'Associé'),
       u.email, now()
from auth.users u
where not exists (select 1 from public.membres m where m.user_id = u.id)
on conflict (user_id) do nothing;

-- Les 34 projets sans auteur — imports de juin et créations par API pendant
-- les séances de travail — sont rattachés au compte principal. Sans cela ils
-- deviendraient invisibles pour tout le monde une fois le cloisonnement actif.
update public.projets
   set created_by = (select id from auth.users where email = 'agence.celexia@gmail.com')
 where created_by is null;

-- RLS sur la table elle-même : chacun lit sa fiche, seul un fondateur gère
-- les autres. `est_fondateur()` étant SECURITY DEFINER, elle ne repasse pas
-- par ces policies — pas de récursion.
alter table public.membres enable row level security;

drop policy if exists membres_lecture on public.membres;
create policy membres_lecture on public.membres
  for select to authenticated
  using (user_id = auth.uid() or public.est_fondateur());

drop policy if exists membres_ecriture on public.membres;
create policy membres_ecriture on public.membres
  for all to authenticated
  using (public.est_fondateur())
  with check (public.est_fondateur());
