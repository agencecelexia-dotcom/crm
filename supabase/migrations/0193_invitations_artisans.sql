-- Journal d'envoi : une même demande ne peut remettre qu'un seul email à Gmail.
create table public.invitations_artisans (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  email text not null,
  prenom text not null default '', nom text not null default '', societe text not null default '',
  taux integer not null check (taux in (10,15,20)),
  etat text not null default 'reserve' check (etat in ('reserve','en_cours','confirme','incertain')),
  gmail_message_id text,
  created_at timestamptz not null default now(),
  envoye_at timestamptz
);
create index invitations_artisans_auteur_date_idx on public.invitations_artisans(created_by,created_at desc);
alter table public.invitations_artisans enable row level security;
create policy invitations_artisans_lecture on public.invitations_artisans for select to authenticated
using (exists (select 1 from public.membres m where m.user_id = auth.uid() and m.actif)
  and (public.est_fondateur() or created_by = auth.uid()));
revoke all on public.invitations_artisans from anon, authenticated;
grant select on public.invitations_artisans to authenticated;
grant all on public.invitations_artisans to service_role;
