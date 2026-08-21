-- Espace commercial : rétrocessions et invitation.
--
-- Le commercial saisit des leads, les attribue, et surtout reprend les
-- chantiers rendus par l'artisan principal pour les replacer ailleurs. Il
-- touche 10 % de la commission agence — versés À L'ENCAISSEMENT, pas à la
-- signature.
--
-- Ce choix n'est pas cosmétique : 80 % de la commission acquise n'est pas
-- encore encaissée (21 332 € sur 26 606 €). Déclencher à la signature
-- reviendrait à avancer une rétrocession sur des dossiers non payés.

create table if not exists public.retrocessions (
  id                uuid primary key default gen_random_uuid(),
  membre_id         uuid not null references public.membres(id) on delete restrict,
  projet_id         uuid not null references public.projets(id) on delete cascade,

  -- Figés à la création : le taux du membre peut changer, une rétrocession
  -- déjà due ne doit pas bouger rétroactivement.
  commission_agence numeric(12,2) not null,
  taux              numeric(4,3)  not null,
  montant           numeric(12,2) not null,

  statut            text not null default 'a_verser'
                    check (statut in ('a_verser', 'verse', 'annule')),
  verse_at          timestamptz,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Un projet ne génère qu'une rétrocession par commercial.
  unique (membre_id, projet_id)
);

comment on table public.retrocessions is
  'Part de commission due à un commercial. Créée quand l''agence encaisse, jamais à la signature.';
comment on column public.retrocessions.commission_agence is
  'Commission agence au moment du déclenchement. Figée : une rétrocession due ne change pas si le taux du membre évolue.';

create index if not exists idx_retro_membre on public.retrocessions(membre_id, statut);
create index if not exists idx_retro_projet on public.retrocessions(projet_id);

drop trigger if exists trg_retro_updated on public.retrocessions;
create trigger trg_retro_updated before update on public.retrocessions
  for each row execute function public.set_updated_at();

alter table public.retrocessions enable row level security;

-- Un commercial voit ses rétrocessions, jamais celles des autres.
drop policy if exists retro_lecture on public.retrocessions;
create policy retro_lecture on public.retrocessions
  for select to authenticated
  using (
    public.est_fondateur()
    or membre_id in (select id from public.membres where user_id = auth.uid())
  );

-- Seul le fondateur marque une rétrocession comme versée.
drop policy if exists retro_ecriture on public.retrocessions;
create policy retro_ecriture on public.retrocessions
  for all to authenticated
  using (public.est_fondateur()) with check (public.est_fondateur());

-- ---------------------------------------------------------------------------
-- Déclenchement : au passage de `commission_encaissee` à vrai.

create or replace function public.generer_retrocession()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membre  public.membres;
  v_user    uuid;
begin
  -- Uniquement au FRANCHISSEMENT : repasser un encaissement déjà vrai ne doit
  -- pas créer de doublon.
  if coalesce(new.commission_encaissee, false) = false
     or coalesce(old.commission_encaissee, false) = true then
    return new;
  end if;

  if coalesce(new.commission, 0) <= 0 then
    return new;
  end if;

  -- Le commercial qui a repris le chantier prime sur celui qui l'a saisi :
  -- c'est la reprise qui crée la valeur dans ce modèle.
  v_user := coalesce(new.assigne_a, new.created_by);
  if v_user is null then return new; end if;

  select * into v_membre from public.membres
   where user_id = v_user and role = 'commercial' and actif;
  if v_membre.id is null then return new; end if;

  insert into public.retrocessions
    (membre_id, projet_id, commission_agence, taux, montant)
  values
    (v_membre.id, new.id, new.commission, v_membre.taux_retrocession,
     round(new.commission * v_membre.taux_retrocession, 2))
  on conflict (membre_id, projet_id) do nothing;

  return new;
end $$;

comment on function public.generer_retrocession() is
  'Crée la rétrocession du commercial quand l''agence encaisse la commission. Idempotent : rejouer l''encaissement ne duplique pas.';

drop trigger if exists trg_generer_retrocession on public.projets;
create trigger trg_generer_retrocession
  after update of commission_encaissee on public.projets
  for each row execute function public.generer_retrocession();

-- ---------------------------------------------------------------------------
-- Tableau de bord du commercial.

create or replace function public.mes_stats_commercial()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with moi as (
    select * from public.membres where user_id = auth.uid() and actif
  ),
  -- Ses leads : ceux qu'il a saisis et ceux qu'on lui a confiés à reprendre.
  p as (
    select pr.* from public.projets pr
    where pr.deleted_at is null
      and (pr.created_by = auth.uid() or pr.assigne_a = auth.uid())
  ),
  af as (
    select a.* from public.affectations a
    join p on p.id = a.projet_id
  )
  select json_build_object(
    'nom',   (select nom from moi),
    'taux',  (select taux_retrocession from moi),

    -- Activité
    'leads_saisis',      (select count(*) from p where created_by = auth.uid()),
    'leads_repris',      (select count(*) from p where assigne_a = auth.uid()),
    'leads_actifs',      (select count(*) from p
                           where statut not in ('perdu','mort','termine','devis_signe',
                                                'artisan_demarche','demarchage')),
    'a_attribuer',       (select count(*) from p
                           where not exists (select 1 from public.affectations a
                                              where a.projet_id = p.id and a.retire_at is null)
                             and statut not in ('perdu','mort','artisan_demarche','demarchage')),

    -- Résultats
    'signes',            (select count(*) from af where issue = 'gagne'),
    'perdus',            (select count(*) from af where issue = 'perdu'),
    'ca_genere',         (select coalesce(sum(coalesce(montant_devis_signe, montant_devis)), 0)
                           from af where issue = 'gagne'),

    -- Gains : trois états, pour qu'il sache où il en est
    'gains_potentiels',  (select coalesce(sum(round(pr.commission * (select taux_retrocession from moi), 2)), 0)
                           from p pr where pr.statut in ('devis_signe','termine')
                             and not coalesce(pr.commission_encaissee, false)),
    'gains_a_percevoir', (select coalesce(sum(montant), 0) from public.retrocessions r
                           join moi on moi.id = r.membre_id where r.statut = 'a_verser'),
    'gains_verses',      (select coalesce(sum(montant), 0) from public.retrocessions r
                           join moi on moi.id = r.membre_id where r.statut = 'verse'),

    -- Le vivier de reprise : chantiers rendus, encore vivants, sans artisan.
    'a_reprendre',       (select count(*) from public.projets pr
                           where pr.deleted_at is null
                             and pr.statut not in ('mort','devis_signe','termine',
                                                   'artisan_demarche','demarchage')
                             and exists (select 1 from public.affectations a
                                          where a.projet_id = pr.id and a.retire_at is not null)
                             and not exists (select 1 from public.affectations a
                                              where a.projet_id = pr.id and a.retire_at is null
                                                and a.issue = 'en_cours'))
  );
$$;

comment on function public.mes_stats_commercial() is
  'Tableau de bord d''un commercial : son activité, ses résultats, ses gains en trois états.';

revoke execute on function public.mes_stats_commercial() from public, anon;
grant execute on function public.mes_stats_commercial() to authenticated;

-- ---------------------------------------------------------------------------
-- Invitation d'un commercial.
--
-- Le compte `auth.users` est créé côté application (l'API d'administration
-- Supabase n'est pas appelable depuis SQL). Cette fonction enregistre le
-- membre et déclenche l'e-mail ; l'application appelle `inviteUserByEmail`
-- juste avant.

create or replace function public.inviter_commercial(
  p_user_id uuid,
  p_email   text,
  p_nom     text,
  p_taux    numeric default 0.10
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;
  if coalesce(btrim(p_nom), '') = '' then
    return json_build_object('ok', false, 'error', 'nom_requis');
  end if;
  if p_taux < 0 or p_taux > 1 then
    return json_build_object('ok', false, 'error', 'taux_invalide');
  end if;

  insert into public.membres (user_id, role, nom, email, taux_retrocession, invite_par)
  values (p_user_id, 'commercial', btrim(p_nom), lower(btrim(p_email)), p_taux, auth.uid())
  on conflict (user_id) do update
    set nom = excluded.nom, email = excluded.email,
        taux_retrocession = excluded.taux_retrocession, actif = true
  returning id into v_id;

  perform net.http_post(
    url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
    body := jsonb_build_object(
      'event', 'invitation_commercial',
      'email', lower(btrim(p_email)),
      'nom',   btrim(p_nom),
      'lien',  'https://crm-ci7k.vercel.app/login'
    )
  );

  return json_build_object('ok', true, 'membre_id', v_id);
end $$;

revoke execute on function public.inviter_commercial(uuid, text, text, numeric) from public, anon;
grant execute on function public.inviter_commercial(uuid, text, text, numeric) to authenticated;
