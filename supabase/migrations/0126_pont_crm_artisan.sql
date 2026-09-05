-- Pont entre l'espace artisan et le CRM propre de l'artisan.
--
-- LE PROBLÈME
--
-- L'artisan travaille dans SON outil. Notre portail `/artisan/<token>` lui
-- demande de ressaisir ce qu'il vient déjà d'enregistrer chez lui. Une double
-- saisie n'est jamais faite sérieusement : c'est la raison pour laquelle des
-- étapes traînent alors que le chantier a avancé.
--
-- CE QUI EXISTE DÉJÀ — et qu'on ne réécrit pas
--
-- Le sens ARTISAN → NOUS est en place depuis longtemps, sans qu'on l'ait vu
-- comme une API : `get_espace_artisan()` renvoie tout son pipe, jetons
-- d'affectation compris, et `add_suivi_by_token()` /
-- `corriger_etape_by_token()` / `retirer_chantier_by_token()` écrivent en
-- appliquant TOUTES les règles métier (étape monotone, correction en arrière
-- autorisée, motif de perte obligatoire, recalcul de commission). Elles sont
-- `security definer` et accessibles à `anon` : son CRM peut déjà les appeler.
--
-- CE QUI MANQUE — et que cette migration pose
--
--   1. Le sens NOUS → LUI. Aujourd'hui il faut interroger en boucle. Un lead
--      déposé doit ARRIVER chez lui, sans qu'il demande.
--   2. L'idempotence. Son adaptateur réessaiera ; sans garde, chaque reprise
--      créerait un doublon dans `suivis`.
--   3. La rupture de boucle. Il modifie → on reçoit → on lui renvoie → il
--      renvoie… Sans coupure explicite, tout système bidirectionnel boucle.
--   4. La traçabilité. Une intégration partenaire qui casse en silence est
--      pire que pas d'intégration : on croit le pipe à jour alors qu'il est
--      figé.
--
-- QUI FAIT AUTORITÉ SUR QUOI
--
-- Décidé ici une fois pour toutes, sinon les données divergent sans qu'on
-- s'en aperçoive avant la facturation :
--
--   * L'ARTISAN fait autorité sur l'AVANCEMENT de son chantier — étape,
--     montant du devis, date de RDV, abandon motivé.
--   * L'AGENCE fait autorité sur la PROPRIÉTÉ du lead — attribution, retrait,
--     réattribution, commission encaissée, suppression.
--
-- Un camp n'écrase jamais les champs de l'autre. Une tentative refusée n'est
-- pas perdue pour autant : elle est journalisée dans `pont_entrant`.
--
-- LIVRAISON AU MOINS UNE FOIS
--
-- On garantit qu'un événement finit par arriver, pas qu'il n'arrive qu'une
-- fois. C'est le contrat standard, et le seul tenable quand le réseau peut
-- tomber entre l'envoi et l'accusé. Chaque envoi porte un identifiant stable :
-- l'adaptateur de l'artisan doit ignorer un identifiant déjà traité. La
-- spécification qu'on lui remet le dit explicitement.

-- `hmac()` signe les envois sortants. Idempotent, et sans effet si pgcrypto
-- est déjà installé ailleurs — les fonctions ci-dessous portent `extensions`
-- dans leur `search_path` pour le trouver quel que soit son schéma.
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  -- Schéma `extensions` absent, ou droits refusés : on retente sans le
  -- forcer. Les fonctions ci-dessous appellent `hmac()` SANS qualification
  -- de schéma et portent `public` + `extensions` dans leur `search_path` :
  -- elles la trouvent où qu'elle soit installée.
  create extension if not exists pgcrypto;
end $$;

-- ---------- 1) La configuration, un pont par artisan ----------
--
-- Table séparée plutôt que colonnes sur `artisans` : `artisans` est lue par
-- tous les écrans, et un secret de signature n'a rien à faire dans une ligne
-- qui circule partout.

create table if not exists public.ponts_artisan (
  artisan_id  uuid primary key references public.artisans(id) on delete cascade,

  -- Défaut `false` : poser la migration ne branche personne. On active
  -- artisan par artisan, en connaissance de cause.
  actif       boolean not null default false,

  -- Où POSTer ses événements. Tant qu'elle est vide, rien ne part — les
  -- événements s'accumulent en file et seront livrés dès qu'elle est saisie.
  url_webhook text,

  -- Identifiant public, qu'il met dans ses en-têtes pour se présenter.
  cle_publique text not null unique
              default 'pont_' || replace(gen_random_uuid()::text, '-', ''),

  -- Secret de signature HMAC-SHA256. Ne quitte jamais le serveur autrement
  -- que par l'écran fondateur, et se régénère d'un clic.
  secret      text not null
              default encode(gen_random_bytes(32), 'hex'),

  derniere_reussite_at timestamptz,
  dernier_echec_at     timestamptz,
  dernier_echec        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_ponts_artisan_updated on public.ponts_artisan;
create trigger trg_ponts_artisan_updated
  before update on public.ponts_artisan
  for each row execute function public.set_updated_at();

comment on table public.ponts_artisan is
  'Configuration du pont vers le CRM propre d''un artisan. Le secret sert à '
  'signer les envois sortants ; les entrants s''authentifient avec le jeton '
  'd''affectation, comme le reste du portail.';

alter table public.ponts_artisan enable row level security;

do $$
begin
  drop policy if exists ponts_artisan_fondateur on public.ponts_artisan;
  create policy ponts_artisan_fondateur on public.ponts_artisan
    for all using (public.est_fondateur()) with check (public.est_fondateur());
end $$;

-- ---------- 2) La file de sortie ----------
--
-- POURQUOI UNE FILE plutôt qu'un appel direct depuis le déclencheur.
--
-- Un trigger qui fait un appel réseau bloque la transaction : si le serveur de
-- l'artisan est lent, l'attribution du lead attend ; s'il est en panne, elle
-- ÉCHOUE. Son indisponibilité ne peut pas empêcher Antoine d'attribuer un
-- chantier. Le déclencheur écrit donc une ligne, et rien d'autre. La livraison
-- devient un problème séparé, avec ses propres réessais.

create table if not exists public.pont_sortant (
  id          bigserial primary key,
  artisan_id  uuid not null references public.artisans(id) on delete cascade,
  type        text not null,
  charge      jsonb not null,

  etat        text not null default 'en_attente'
              check (etat in ('en_attente', 'envoye', 'echoue', 'abandonne')),
  tentatives  int not null default 0,
  prochaine_tentative_at timestamptz not null default now(),
  -- Identifiant de requête pg_net, le temps de lire la réponse.
  requete_id  bigint,
  envoye_at   timestamptz,
  code_http   int,
  erreur      text,

  created_at  timestamptz not null default now()
);

create index if not exists idx_pont_sortant_du
  on public.pont_sortant (prochaine_tentative_at)
  where etat in ('en_attente', 'echoue');

create index if not exists idx_pont_sortant_attente_reponse
  on public.pont_sortant (requete_id)
  where etat = 'envoye' and code_http is null;

comment on table public.pont_sortant is
  'File des événements à livrer au CRM de l''artisan. Écrite par les '
  'déclencheurs, vidée par `livrer_pont_sortant()` toutes les minutes.';

alter table public.pont_sortant enable row level security;

do $$
begin
  drop policy if exists pont_sortant_fondateur on public.pont_sortant;
  create policy pont_sortant_fondateur on public.pont_sortant
    for select using (public.est_fondateur());
end $$;

-- ---------- 3) Le journal d'entrée ----------
--
-- Sert deux choses à la fois : l'idempotence (un identifiant déjà vu renvoie
-- le même résultat sans rejouer l'écriture) et l'audit — quand une intégration
-- partenaire dérape, c'est ici qu'on lit ce qui est réellement arrivé.

create table if not exists public.pont_entrant (
  id            bigserial primary key,
  artisan_id    uuid references public.artisans(id) on delete cascade,
  -- Identifiant fourni par SON système. C'est la clé de déduplication.
  evenement_id  text not null,
  type          text,
  charge        jsonb,
  resultat      jsonb,
  recu_at       timestamptz not null default now(),

  unique (artisan_id, evenement_id)
);

create index if not exists idx_pont_entrant_recent
  on public.pont_entrant (artisan_id, recu_at desc);

alter table public.pont_entrant enable row level security;

do $$
begin
  drop policy if exists pont_entrant_fondateur on public.pont_entrant;
  create policy pont_entrant_fondateur on public.pont_entrant
    for select using (public.est_fondateur());
end $$;

-- ---------- 4) La forme d'un chantier ----------
--
-- VOLONTAIREMENT IDENTIQUE à une entrée de `get_espace_artisan().projets` :
-- son adaptateur n'a qu'UN seul schéma à comprendre, qu'il lise le pipe entier
-- ou qu'il reçoive un événement. Toute divergence entre les deux formes se
-- paierait en bugs chez lui, donc chez nous.
--
-- L'identité du client suit la même règle que le portail : masquée tant que
-- l'engagement n'est pas signé.

create or replace function public.pont_chantier_json(p_affectation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v jsonb;
  v_signe boolean;
begin
  -- Même règle que le portail (`get_espace_artisan`) : l'identité du client
  -- n'apparaît qu'une fois l'engagement signé, ou si l'artisan est sous
  -- contrat externe. Le contrat retenu est le PREMIER créé, comme le fait
  -- `ensure_engagement_contrat` — s'aligner sur une autre ligne démasquerait
  -- des coordonnées que le portail, lui, masque encore.
  select coalesce(
           (select c.statut = 'signe'
              from public.contrats c
             where c.artisan_id = a.id
             order by c.created_at asc
             limit 1),
           false)
         or coalesce(a.contrat_externe, false)
    into v_signe
    from public.affectations af
    join public.artisans a on a.id = af.artisan_id
   where af.id = p_affectation_id;

  select jsonb_build_object(
    'id', af.id,
    'token', af.token,
    'statut', af.statut,
    'etape', af.etape,
    'issue', af.issue,
    'en_attente_depuis', af.en_attente_depuis,
    'rappel_le', af.rappel_le,
    'recu_le', coalesce(af.created_at, p.created_at),
    'derniere_activite', af.updated_at,
    'retire_at', af.retire_at,
    'date_rdv', af.date_rdv,
    'metier', p.metier,
    'metiers', p.metiers,
    'sous_metier', p.sous_metier,
    'description', p.description,
    'budget_estime', p.budget_estime,
    'montant_devis', af.montant_devis,
    'montant_devis_signe', af.montant_devis_signe,
    'client_ville', p.client_ville,
    'devis_depose', af.devis_url is not null,
    'devis_signe_depose', af.devis_signe_url is not null,
    'client_nom',        case when v_signe then p.client_nom end,
    'client_telephone',  case when v_signe then p.client_telephone end,
    'client_email',      case when v_signe then p.client_email end,
    'client_adresse',    case when v_signe then p.client_adresse end,
    'client_code_postal',case when v_signe then p.client_code_postal end
  )
    into v
    from public.affectations af
    join public.projets p on p.id = af.projet_id
   where af.id = p_affectation_id;

  return v;
end
$function$;

comment on function public.pont_chantier_json(uuid) is
  'Un chantier au format exact d''une entrée de get_espace_artisan().projets. '
  'Même schéma des deux côtés du pont : l''adaptateur n''en apprend qu''un.';

-- ---------- 5) Mise en file ----------
--
-- LA RUPTURE DE BOUCLE se joue ici. Quand un changement nous arrive DE
-- l'artisan, `pont_entrant()` pose `celexia.pont_origine = 'artisan'` pour la
-- durée de la transaction. Tous les déclencheurs qui s'ensuivent le lisent et
-- s'abstiennent : on ne lui réexpédie pas ce qu'il vient de nous dire.
--
-- Le réglage est LOCAL à la transaction (3e argument `true`) — il ne fuit pas
-- sur la connexion suivante du pool.

-- Garde bon marché, appelée AVANT de construire une charge utile. Sans elle,
-- chaque attribution paierait la sérialisation d'un chantier complet même
-- quand aucun artisan n'est branché — c'est-à-dire, aujourd'hui, toujours.
create or replace function public.pont_ouvert(p_artisan_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  -- La rupture d'écho porte l'IDENTIFIANT de l'artisan à l'origine du
  -- changement, pas un simple drapeau. Un chantier peut être affecté à
  -- plusieurs artisans : ce que l'un déclare doit continuer d'être poussé
  -- aux autres, seul l'auteur ne doit pas recevoir son propre écho.
  select p_artisan_id is not null
     and public.automatisation_active('pont_crm_artisan')
     and coalesce(current_setting('celexia.pont_origine', true), '')
         is distinct from p_artisan_id::text
     and exists (select 1 from public.ponts_artisan
                  where artisan_id = p_artisan_id and actif);
$function$;

create or replace function public.pont_enfiler(
  p_artisan_id uuid,
  p_type text,
  p_charge jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  -- Interrupteur global, rupture d'écho et pont actif : les trois conditions
  -- tiennent dans `pont_ouvert()`, appelée aussi par les déclencheurs avant
  -- qu'ils ne construisent quoi que ce soit.
  if not public.pont_ouvert(p_artisan_id) then return; end if;

  insert into public.pont_sortant (artisan_id, type, charge)
  values (p_artisan_id, p_type, p_charge);
end
$function$;

comment on function public.pont_enfiler(uuid, text, jsonb) is
  'Met un événement en file pour le CRM de l''artisan. Ne fait AUCUN appel '
  'réseau : une panne chez lui ne doit jamais faire échouer notre écriture.';

-- ---------- 6) Les déclencheurs ----------
--
-- Trois événements, choisis parce qu'ils sont les seuls qu'il ne peut pas
-- deviner : un chantier lui arrive, un chantier lui est repris, l'agence lui
-- écrit. Son propre travail, il le connaît déjà — le renvoyer serait du bruit.

create or replace function public.trg_pont_affectation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not public.pont_ouvert(new.artisan_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    perform public.pont_enfiler(
      new.artisan_id, 'chantier_attribue', public.pont_chantier_json(new.id));

  elsif tg_op = 'UPDATE' then
    -- Reprise : le chantier sort de son pipe. Le prévenir est le minimum,
    -- sinon il continue de travailler un lead qui ne lui appartient plus.
    if old.retire_at is null and new.retire_at is not null then
      perform public.pont_enfiler(
        new.artisan_id, 'chantier_retire', public.pont_chantier_json(new.id));

    -- Restauration après retrait.
    elsif old.retire_at is not null and new.retire_at is null then
      perform public.pont_enfiler(
        new.artisan_id, 'chantier_attribue', public.pont_chantier_json(new.id));
    end if;
  end if;

  return coalesce(new, old);
end
$function$;

drop trigger if exists trg_pont_affectation on public.affectations;
create trigger trg_pont_affectation
  after insert or update on public.affectations
  for each row execute function public.trg_pont_affectation();

create or replace function public.trg_pont_suivi()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_artisan uuid;
begin
  -- Seuls les messages DE L'AGENCE partent. Ceux de l'artisan viennent de lui.
  if new.auteur <> 'agence' or new.affectation_id is null then
    return new;
  end if;

  select artisan_id into v_artisan
    from public.affectations where id = new.affectation_id;

  if not public.pont_ouvert(v_artisan) then return new; end if;

  perform public.pont_enfiler(v_artisan, 'message_agence', jsonb_build_object(
    'affectation_id', new.affectation_id,
    'suivi_id', new.id,
    'message', new.message,
    'created_at', new.created_at,
    'chantier', public.pont_chantier_json(new.affectation_id)
  ));

  return new;
end
$function$;

drop trigger if exists trg_pont_suivi on public.suivis;
create trigger trg_pont_suivi
  after insert on public.suivis
  for each row execute function public.trg_pont_suivi();

-- ---------- 7) La livraison ----------
--
-- `net.http_post` est ASYNCHRONE : il dépose la requête dans la file de pg_net
-- et rend la main. La fonction ci-dessous ne bloque donc sur rien, même si
-- vingt artisans sont injoignables.
--
-- La signature couvre le corps EXACT tel qu'il est envoyé. L'artisan
-- recalcule `HMAC-SHA256(corps, secret)` et compare : c'est ce qui prouve que
-- l'événement vient de nous et n'a pas été altéré.

create or replace function public.livrer_pont_sortant()
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  e record;
  v_body jsonb;
  v_corps text;
  v_req bigint;
  v_n int := 0;
begin
  if not public.automatisation_active('pont_crm_artisan') then return 0; end if;

  for e in
    select s.*, pa.url_webhook, pa.secret, pa.cle_publique
      from public.pont_sortant s
      join public.ponts_artisan pa on pa.artisan_id = s.artisan_id
     where s.etat in ('en_attente', 'echoue')
       and s.prochaine_tentative_at <= now()
       and pa.actif
       and coalesce(pa.url_webhook, '') <> ''
     order by s.id
     limit 100
     -- Le cron bat toutes les minutes. Si un tick déborde, le suivant
     -- démarre pendant qu'il tourne : sans verrou, les deux liraient la même
     -- ligne et l'artisan recevrait l'événement en double. `skip locked` fait
     -- que le second passe simplement à la ligne suivante.
     for update of s skip locked
  loop
    -- Le corps est construit UNE FOIS en jsonb, et c'est sa représentation
    -- textuelle qui est signée. Reconstruire le texte séparément serait un
    -- piège : `jsonb` normalise l'ordre des clés, donc un `::jsonb` appliqué
    -- après coup renverrait des octets différents de ceux qu'on a signés — et
    -- la signature échouerait systématiquement chez l'artisan. pg_net envoie
    -- littéralement `body::text` : signer cette valeur, c'est signer l'envoi.
    v_body := jsonb_build_object(
      'evenement_id', e.id::text,
      'type', e.type,
      'emis_le', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'tentative', e.tentatives + 1,
      'donnees', e.charge
    );
    v_corps := v_body::text;

    v_req := net.http_post(
      url := e.url_webhook,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Celexia-Cle', e.cle_publique,
        'X-Celexia-Evenement', e.id::text,
        -- `hmac` non qualifiée : pgcrypto vit dans `extensions` sur Supabase,
        -- dans `public` ailleurs. Le `search_path` de la fonction couvre les
        -- deux.
        'X-Celexia-Signature', encode(hmac(v_corps, e.secret, 'sha256'), 'hex')
      ),
      body := v_body,
      timeout_milliseconds := 10000
    );

    update public.pont_sortant
       set etat = 'envoye',
           tentatives = tentatives + 1,
           requete_id = v_req,
           envoye_at = now(),
           code_http = null,
           erreur = null
     where id = e.id;

    v_n := v_n + 1;
  end loop;

  return v_n;
end
$function$;

-- ---------- 8) L'accusé de réception ----------
--
-- pg_net range les réponses dans `net._http_response` et les purge au bout de
-- quelques heures. On les lit pour distinguer une livraison réussie d'un échec
-- à réessayer.
--
-- Le bloc est protégé : si la table de pg_net change de forme, le cron ne doit
-- pas tomber. Un événement dont on n'a jamais lu la réponse est simplement
-- RÉESSAYÉ au bout d'un quart d'heure — la livraison est « au moins une fois »,
-- et l'adaptateur de l'artisan déduplique sur `evenement_id`.

create or replace function public.reconcilier_pont_sortant()
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_n int := 0;
begin
  begin
    with reponses as (
      select s.id,
             r.status_code,
             r.error_msg
        from public.pont_sortant s
        join net._http_response r on r.id = s.requete_id
       where s.etat = 'envoye' and s.code_http is null
    )
    update public.pont_sortant s
       set code_http = rp.status_code,
           etat = case
                    when rp.status_code between 200 and 299 then 'envoye'
                    -- 6 tentatives : ~1 h de réessais avec le recul
                    -- exponentiel ci-dessous. Au-delà, l'échec est durable
                    -- et doit être VU, pas réessayé indéfiniment.
                    when s.tentatives >= 6 then 'abandonne'
                    else 'echoue'
                  end,
           erreur = case
                      when rp.status_code between 200 and 299 then null
                      else coalesce(rp.error_msg, 'HTTP ' || coalesce(rp.status_code::text, '?'))
                    end,
           -- Recul exponentiel : 2, 4, 8, 16, 32, 64 minutes.
           prochaine_tentative_at =
             now() + (power(2, least(s.tentatives, 6)) * interval '1 minute')
      from reponses rp
     where s.id = rp.id;

    get diagnostics v_n = row_count;
  exception when others then
    -- pg_net indisponible ou table absente : on ne casse pas le cron.
    v_n := 0;
  end;

  -- Sans réponse au bout d'un quart d'heure, on réessaie.
  update public.pont_sortant
     set etat = case when tentatives >= 6 then 'abandonne' else 'echoue' end,
         erreur = coalesce(erreur, 'aucune réponse'),
         prochaine_tentative_at = now()
   where etat = 'envoye' and code_http is null
     and envoye_at < now() - interval '15 minutes';

  -- Report du dernier état sur la configuration : c'est ce que l'écran
  -- fondateur affiche pour dire si le pont vit ou s'il est mort.
  update public.ponts_artisan pa
     set derniere_reussite_at = r.quand
    from (
      select artisan_id, max(envoye_at) as quand
        from public.pont_sortant
       where code_http between 200 and 299
       group by artisan_id
    ) r
   where r.artisan_id = pa.artisan_id
     and r.quand is distinct from pa.derniere_reussite_at;

  update public.ponts_artisan pa
     set dernier_echec_at = d.quand, dernier_echec = d.motif
    from (
      select distinct on (artisan_id) artisan_id, envoye_at as quand, erreur as motif
        from public.pont_sortant
       where etat in ('echoue', 'abandonne') and erreur is not null
       order by artisan_id, id desc
    ) d
   where d.artisan_id = pa.artisan_id;

  return v_n;
end
$function$;

-- ---------- 9) Le battement ----------
--
-- Chaque minute : on livre ce qui est dû, on relève les réponses. Enveloppé
-- dans le garde-fou d'automatisation comme les autres tâches planifiées.

create or replace function public.pont_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not public.automatisation_active('pont_crm_artisan') then return; end if;
  perform public.livrer_pont_sortant();
  perform public.reconcilier_pont_sortant();
end
$function$;

select cron.unschedule('pont_tick')
 where exists (select 1 from cron.job where jobname = 'pont_tick');

select cron.schedule('pont_tick', '* * * * *', $$ select public.pont_tick(); $$);

-- ---------- 10) L'entrée ----------
--
-- Point d'entrée UNIQUE pour le CRM de l'artisan. Il ne réimplémente aucune
-- règle : il délègue aux fonctions du portail, déjà éprouvées, et ajoute les
-- trois choses qui manquaient — déduplication, rupture d'écho, journal.
--
-- AUTHENTIFICATION : le jeton d'affectation, comme tout le reste du portail.
-- C'est un secret de 32 caractères, propre à un chantier, révocable en
-- retirant l'affectation. Exiger en plus une signature obligerait l'artisan à
-- écrire un client HTTP dédié au lieu d'appeler PostgREST directement — ce
-- serait payer cher une sécurité que le modèle du portail assure déjà.

create or replace function public.pont_entrant(
  p_token text,
  p_evenement_id text,
  p_type text,
  p_statut text default null,
  p_message text default null,
  p_date_rdv timestamptz default null,
  p_montant_devis numeric default null,
  p_montant_devis_signe numeric default null,
  p_motif text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  af public.affectations;
  -- `pont_entrant.resultat` est en jsonb, les fonctions du portail rendent du
  -- json : on garde les deux types distincts et on convertit explicitement,
  -- plutôt que de compter sur une conversion implicite à l'affectation.
  v_deja jsonb;
  v_res json;
begin
  if coalesce(btrim(p_evenement_id), '') = '' then
    return json_build_object('ok', false, 'error', 'evenement_id_requis');
  end if;

  select * into af from public.affectations where token = p_token;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if not exists (
    select 1 from public.ponts_artisan
     where artisan_id = af.artisan_id and actif
  ) then
    return json_build_object('ok', false, 'error', 'pont_inactif');
  end if;

  -- IDEMPOTENCE. Son adaptateur réessaiera — c'est même exigé de lui. Rejouer
  -- l'écriture créerait un doublon de suivi ; on renvoie le résultat d'origine.
  --
  -- Deux appels VRAIMENT simultanés passeraient tous deux ce test : c'est la
  -- contrainte d'unicité, plus bas, qui tranche. Le perdant échoue en bloc et
  -- n'écrit donc rien ; son réessai retombera ici et lira le résultat du
  -- gagnant. Le doublon est impossible, seule la réponse est différée.
  select resultat into v_deja
    from public.pont_entrant
   where artisan_id = af.artisan_id and evenement_id = p_evenement_id;
  if found then
    return coalesce(v_deja::json, json_build_object('ok', true, 'rejoue', true));
  end if;

  -- RUPTURE D'ÉCHO, valable pour toute la transaction : les déclencheurs
  -- déclenchés par les appels ci-dessous ne réexpédieront rien VERS LUI. Les
  -- autres artisans du même chantier, eux, restent servis.
  perform set_config('celexia.pont_origine', af.artisan_id::text, true);

  -- Montants : champs dont l'ARTISAN est propriétaire.
  if p_montant_devis is not null then
    update public.affectations set montant_devis = p_montant_devis where id = af.id;
  end if;

  -- Le montant signé n'a de sens qu'au-delà de la signature. L'accepter plus
  -- tôt rouvrirait exactement l'incohérence que 0121 a fermée.
  if p_montant_devis_signe is not null
     and public.rang_etape(coalesce(p_statut, af.etape))
         >= public.rang_etape('devis_signe') then
    update public.affectations
       set montant_devis_signe = p_montant_devis_signe where id = af.id;
  end if;

  -- Aiguillage vers les fonctions du portail. Aucune règle n'est recopiée.
  --
  -- Arguments NOMMÉS : `retirer_chantier_by_token` prend la raison AVANT le
  -- motif (0079). Un appel positionnel les intervertirait silencieusement,
  -- et le motif atterrirait dans la justification libre.
  if p_type = 'perdu' then
    -- Le motif appartient à une liste fermée (`origine_du_motif`, 0079). Le
    -- refuser ICI donne à l'artisan un message exploitable, là où la fonction
    -- du portail se contenterait d'un `motif_requis` sans dire lesquels.
    if public.origine_du_motif(p_motif) is null then
      return json_build_object(
        'ok', false, 'error', 'motif_invalide',
        'motifs_admis', array['hors_zone','doublon','hors_competence',
          'delai_incompatible','prix_trop_eleve','budget_insuffisant',
          'signe_concurrent','client_injoignable','client_renonce',
          'non_eligible_aides']);
    end if;

    v_res := public.retirer_chantier_by_token(
      p_token          := p_token,
      p_raison         := coalesce(btrim(p_message), ''),
      p_motif          := p_motif,
      p_recontacter_le := null::date);

  elsif p_type = 'correction' then
    -- Corriger, c'est désigner l'étape à laquelle on revient. Sans elle,
    -- l'appel n'a rien à appliquer.
    if coalesce(btrim(p_statut), '') = '' then
      return json_build_object('ok', false, 'error', 'statut_requis');
    end if;
    v_res := public.corriger_etape_by_token(p_token, p_statut);

  else
    -- 'statut' et 'note' passent par le même chemin : c'est la présence d'un
    -- statut qui fait la différence, exactement comme dans le portail.
    v_res := public.add_suivi_by_token(p_token, p_statut, p_message, p_date_rdv);
  end if;

  insert into public.pont_entrant
    (artisan_id, evenement_id, type, charge, resultat)
  values (af.artisan_id, p_evenement_id, p_type,
          jsonb_build_object(
            'statut', p_statut, 'message', p_message, 'date_rdv', p_date_rdv,
            'montant_devis', p_montant_devis,
            'montant_devis_signe', p_montant_devis_signe, 'motif', p_motif),
          v_res::jsonb);

  return v_res;
end
$function$;

comment on function public.pont_entrant(text, text, text, text, text, timestamptz, numeric, numeric, text) is
  'Entrée unique du CRM partenaire. Délègue aux fonctions du portail et '
  'ajoute déduplication, rupture d''écho et journal. Authentifié par le jeton '
  'd''affectation, comme le reste de l''espace artisan.';

revoke execute on function public.pont_entrant(text, text, text, text, text, timestamptz, numeric, numeric, text) from public;
grant execute on function public.pont_entrant(text, text, text, text, text, timestamptz, numeric, numeric, text) to anon, authenticated;

-- ---------- 11) L'interrupteur ----------

insert into public.app_settings (cle, valeur)
values ('pont_crm_artisan', 'on')
on conflict (cle) do nothing;
