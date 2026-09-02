-- Générateur de créatives publicitaires.
--
-- Celexia dépense environ 6 900 € par mois en publicité, et le business plan
-- place « test massif de formats publicitaires » dans les objectifs à 3 mois.
-- Produire ces visuels demandait jusqu'ici un outil externe.
--
-- CE QUE CETTE MIGRATION POSE
--
-- La table des générations, le bucket qui conserve les fichiers, et le
-- garde-fou de volume. La génération elle-même passe par des edge functions :
-- la clé fal ne doit jamais atteindre le navigateur, dont le bundle est public.
--
-- POURQUOI UN PLAFOND
--
-- Les tarifs fal s'étalent de 0,0045 $ à 5,00 $ par image selon le modèle —
-- un facteur mille. Vingt clics sur le mauvais modèle coûtent 100 $. Le
-- plafond bloque en base, pas seulement à l'écran : un appel direct à l'edge
-- function doit être refusé de la même façon.

-- ---------- 1) Les générations ----------

create table if not exists public.creatives (
  id           uuid primary key default gen_random_uuid(),
  cree_par     uuid references auth.users(id) on delete set null,

  -- Identifiant fal complet, ex. `fal-ai/flux/schnell`. Volontairement libre :
  -- le catalogue compte 1 491 modèles et bouge en permanence.
  modele       text not null,
  categorie    text not null default 'text-to-image',
  prompt       text,
  -- Paramètres réellement envoyés, tels que le schéma du modèle les a définis.
  -- Les conserver permet de rejouer une génération à l'identique.
  parametres   jsonb not null default '{}'::jsonb,
  format       text,

  statut       text not null default 'en_cours'
               check (statut in ('en_cours', 'reussi', 'echoue')),
  request_id   text,
  -- Chemins dans le bucket `creatives`, pas les URL fal : celles-ci expirent.
  fichiers     text[] not null default '{}',
  cout_estime  numeric(10, 4),
  erreur       text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_creatives_recentes
  on public.creatives (created_at desc);
create index if not exists idx_creatives_en_cours
  on public.creatives (request_id) where statut = 'en_cours';

drop trigger if exists trg_creatives_updated on public.creatives;
create trigger trg_creatives_updated
  before update on public.creatives
  for each row execute function public.set_updated_at();

comment on table public.creatives is
  'Générations de visuels publicitaires via fal.ai. Une ligne par demande, '
  'créée à la soumission et complétée au rapatriement du fichier.';

-- ---------- 2) Réservé aux fondateurs ----------
--
-- Générer engage de l'argent : ce n'est pas au commercial de le faire. Le
-- budget publicitaire relève du périmètre de Thomas.

alter table public.creatives enable row level security;

do $$
begin
  drop policy if exists creatives_lecture on public.creatives;
  drop policy if exists creatives_ecriture on public.creatives;

  create policy creatives_lecture on public.creatives
    for select using (public.est_fondateur());

  create policy creatives_ecriture on public.creatives
    for all using (public.est_fondateur()) with check (public.est_fondateur());
end $$;

-- ---------- 3) Le garde-fou de volume ----------

insert into public.app_settings (cle, valeur)
values ('creatives_plafond_mois', '200')
on conflict (cle) do nothing;

create or replace function public.creatives_du_mois()
returns int
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- Les échecs ne comptent pas : fal ne facture pas une génération ratée, et
  -- les décompter découragerait de réessayer après une panne.
  select count(*)::int
    from public.creatives
   where created_at >= date_trunc('month', now())
     and statut <> 'echoue';
$function$;

create or replace function public.creatives_quota_restant()
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select json_build_object(
    'utilise', public.creatives_du_mois(),
    'plafond', coalesce(
      (select nullif(btrim(valeur), '')::int from public.app_settings
        where cle = 'creatives_plafond_mois'),
      200
    ),
    'reste', greatest(
      coalesce(
        (select nullif(btrim(valeur), '')::int from public.app_settings
          where cle = 'creatives_plafond_mois'),
        200
      ) - public.creatives_du_mois(),
      0
    )
  );
$function$;

comment on function public.creatives_quota_restant() is
  'Consommation du mois face au plafond. Lue par l''écran ET par l''edge '
  'function : bloquer côté interface seulement laisserait passer un appel direct.';

revoke all on function public.creatives_du_mois() from public, anon;
revoke all on function public.creatives_quota_restant() from public, anon;
grant execute on function public.creatives_du_mois() to authenticated;
grant execute on function public.creatives_quota_restant() to authenticated;

-- ---------- 4) Le stockage ----------
--
-- Les URL renvoyées par fal expirent au bout de quelques jours. Sans recopie,
-- la galerie se viderait toute seule.

insert into storage.buckets (id, name, public, file_size_limit)
values ('creatives', 'creatives', false, 52428800)
on conflict (id) do nothing;

do $$
begin
  drop policy if exists creatives_bucket_lecture on storage.objects;
  drop policy if exists creatives_bucket_ecriture on storage.objects;

  create policy creatives_bucket_lecture on storage.objects
    for select using (bucket_id = 'creatives' and public.est_fondateur());

  create policy creatives_bucket_ecriture on storage.objects
    for all using (bucket_id = 'creatives' and public.est_fondateur())
    with check (bucket_id = 'creatives' and public.est_fondateur());
end $$;
