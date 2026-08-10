-- ============================================================
--  0070 — Deux natures de perte, nettoyage du pipe artisan, espace « Perdus ».
--
--  ⚠️ Historique : cette migration a été écrite le 28/07/2026 sous le numéro
--  0062 mais n'a JAMAIS été appliquée en production. Les migrations 0062 à
--  0069 ont été appliquées entre-temps, d'où la renumérotation en 0070 pour
--  refléter l'ordre réel. Conséquence concrète de cet oubli : le front
--  attendait un bloc `stats` que la base ne renvoyait pas, et retombait sur
--  un calcul de repli limité au pipe visible — d'où des statistiques fausses.
--
--  Deux ajouts par rapport à la version d'origine :
--   - le filtre `retire_at` de la migration 0061 est CONSERVÉ (sans quoi
--     réappliquer get_espace_artisan casserait « se retirer d'un chantier ») ;
--   - un bloc `projets_perdus` + une RPC de restauration, pour que l'artisan
--     consulte ses chantiers perdus et puisse les remettre dans son pipe.
--
--  1. Nouveau statut « mort » (AGENCE UNIQUEMENT) : le client a trouvé un
--     artisan ailleurs, le lead n'existe plus pour Celexia. À distinguer de
--     « perdu », qui signifie « cet artisan-là n'a pas conclu » — le chantier
--     reste alors vivant et réattribuable. L'artisan ne peut PAS déclarer
--     « mort » (refusé côté base, pas seulement caché dans l'UI).
--
--  2. Le pipe de l'artisan se nettoie tout seul : un chantier qu'il a passé
--     en « perdu » depuis plus de 15 jours disparaît de sa liste, ainsi que
--     les chantiers masqués explicitement et les projets devenus « morts ».
--     RIEN n'est supprimé : ses statistiques (perdus, taux de conversion,
--     commission) sont désormais calculées côté SQL sur la TOTALITÉ de ses
--     affectations et renvoyées dans un bloc `stats`.
-- ============================================================

-- ---------- 1. Statut « mort » autorisé sur les projets ----------
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.projets'::regclass and contype = 'c' and conname like '%statut%';
  if c is not null then
    execute 'alter table public.projets drop constraint ' || quote_ident(c);
  end if;
end$$;

alter table public.projets
  add constraint projets_statut_check check (statut in (
    'nouveau', 'a_rappeler', 'en_attente', 'artisan_assigne',
    'contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine',
    'perdu', 'mort'
  ));

-- ---------- 2. Colonnes de nettoyage du pipe artisan ----------
alter table public.affectations
  add column if not exists perdu_at timestamptz,
  add column if not exists masque_at timestamptz;

comment on column public.affectations.perdu_at is
  'Date de passage en « perdu » par l''artisan. Au-delà de 15 jours, le chantier sort de son pipe (mais reste dans ses stats).';
comment on column public.affectations.masque_at is
  'Masquage explicite par l''agence : le chantier disparaît du pipe de l''artisan, tout est conservé côté agence.';

-- Pas de backfill : il serait redondant. Les requêtes utilisent
-- `coalesce(af.perdu_at, af.updated_at)`, donc les pertes déjà enregistrées
-- sont traitées correctement sans écrire une seule ligne. Aucune donnée
-- existante n'est modifiée par cette migration.

-- ---------- 3. add_suivi_by_token : « mort » interdit à l'artisan ----------
-- Reprise de la version 0058 (réassignation quand plus aucun artisan actif),
-- avec en plus une whitelist stricte des statuts déclarables par l'artisan et
-- l'entretien de perdu_at.
CREATE OR REPLACE FUNCTION public.add_suivi_by_token(p_token text, p_statut text DEFAULT NULL::text, p_message text DEFAULT NULL::text, p_date_rdv timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  -- Statuts déclarables par l'ARTISAN. « mort » est réservé à l'agence :
  -- seule Celexia sait qu'un client est parti chez un concurrent.
  if coalesce(p_statut, '') <> '' and p_statut not in
     ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'devis_signe', 'termine', 'perdu') then
    return json_build_object('ok', false, 'error', 'statut_non_autorise');
  end if;

  -- Justification écrite OBLIGATOIRE pour déclarer « perdu ».
  if p_statut = 'perdu' and coalesce(btrim(p_message), '') = '' then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  if coalesce(p_statut, '') <> '' then
    update public.affectations
      set statut = p_statut,
          date_rdv = case when p_statut = 'rdv_pris' and p_date_rdv is not null
                          then p_date_rdv else date_rdv end,
          -- Horodate la perte (compte à rebours des 15 jours) ; repartir sur un
          -- autre statut remet le chantier dans le pipe.
          perdu_at = case when p_statut = 'perdu' then coalesce(perdu_at, now()) else null end
      where id = af.id;
    select * into af from public.affectations where id = af.id;

    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'changement_statut',
        'statut', p_statut,
        'artisan', (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
        'client_nom', (select p.client_nom from public.projets p where p.id = af.projet_id),
        'client_ville', (select p.client_ville from public.projets p where p.id = af.projet_id),
        'metier', (select p.metier from public.projets p where p.id = af.projet_id),
        'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
      )
    );
  end if;

  if p_statut = 'devis_signe' then
    -- Un devis signé par un artisan ne fait pas disparaître le chantier pour
    -- les autres : on note simplement le gagnant au niveau du projet.
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;
  elsif p_statut in ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'termine', 'perdu') then
    if exists (select 1 from public.affectations af2
               where af2.projet_id = af.projet_id and af2.statut <> 'perdu') then
      -- Au moins un artisan encore actif : le projet prend le meilleur statut actif.
      update public.projets p set statut = (
        select af2.statut from public.affectations af2
        where af2.projet_id = p.id and af2.statut <> 'perdu'
        order by case af2.statut
          when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
          when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
        limit 1)
      where p.id = af.projet_id;
    else
      -- PLUS AUCUN artisan actif : le dossier REMONTE pour réassignation
      -- (statut 'nouveau', détaché de l'artisan). Un projet déjà déclaré
      -- « mort » par l'agence reste mort — c'est une décision d'agence.
      update public.projets set statut = 'nouveau', artisan_id = null
        where id = af.projet_id and statut <> 'mort';
      insert into public.notifications (type, titre, message, projet_id)
      values ('a_reassigner',
        'A reassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
        'Plus aucun artisan actif (declare perdu). A reattribuer rapidement.'
          || case when coalesce(btrim(p_message), '') <> '' then ' Raison : ' || btrim(p_message) else '' end,
        af.projet_id);
    end if;
  end if;

  return json_build_object('ok', true);
end;
$function$;

-- ---------- 4. get_espace_artisan : pipe nettoyé + stats exhaustives ----------
create or replace function public.get_espace_artisan(p_token text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
begin
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  c := public.ensure_engagement_contrat(a.id);
  v_signe := (c.statut = 'signe') or a.contrat_externe;

  return json_build_object(
    'artisan', json_build_object(
      'id', a.id, 'nom', a.nom, 'prenom', a.prenom, 'societe', a.societe,
      'adresse', a.adresse, 'code_postal', a.code_postal, 'ville', a.ville,
      'siren', a.siren, 'forme_juridique', a.forme_juridique,
      'telephone', a.telephone, 'email', a.email, 'representant', a.representant
    ),
    'engagement', json_build_object(
      'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
      'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
      'signature_data', c.signature_data, 'apporteur_signature', c.apporteur_signature
    ),
    'signe', v_signe,
    'contrat_externe', a.contrat_externe,

    -- Statistiques calculées sur la TOTALITÉ des affectations de l'artisan,
    -- y compris celles masquées ou sorties du pipe : nettoyer sa liste ne
    -- doit jamais fausser ses chiffres.
    'stats', (
      select json_build_object(
        'en_attente', count(*) filter (where af.statut = 'en_attente'),
        'perdus', count(*) filter (where af.statut = 'perdu' or p.statut = 'mort'),
        'devis_envoyes', count(*) filter (where af.statut = 'devis_envoye'),
        'montant_devis_envoyes', coalesce(sum(af.montant_devis) filter (where af.statut = 'devis_envoye'), 0),
        'signes', count(*) filter (where af.statut in ('devis_signe', 'termine')),
        'devis_aboutis', count(*) filter (where af.statut in ('devis_envoye', 'devis_signe', 'termine')),
        'vendu', coalesce(sum(af.montant_devis_signe) filter (where af.statut in ('devis_signe', 'termine')), 0),
        'commission_a_regler', coalesce(sum(p.commission) filter (
          where p.artisan_id = af.artisan_id and p.commission is not null and not p.commission_encaissee), 0),
        'commission_reglee', coalesce(sum(p.commission) filter (
          where p.artisan_id = af.artisan_id and p.commission_encaissee), 0)
      )
      from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id and p.deleted_at is null
    ),

    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          case af.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis, 'montant_devis_signe', af.montant_devis_signe,
            'commission', case when p.artisan_id = af.artisan_id then p.commission end,
            'commission_encaissee',
              case when p.artisan_id = af.artisan_id then p.commission_encaissee else false end,
            'client_ville', p.client_ville, 'photos', coalesce(p.photos, '{}'),
            'devis_depose', af.devis_url is not null,
            'devis_signe_depose', af.devis_signe_url is not null,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            )
          ) as p_json
        from public.affectations af
        join public.projets p on p.id = af.projet_id
        where af.artisan_id = a.id
          and p.deleted_at is null
          and af.retire_at is null          -- ← 0061 : retrait volontaire de l'artisan
          -- Pipe nettoyé : masqués par l'agence, perdus depuis plus de 15
          -- jours, et projets déclarés morts sortent de la liste.
          and af.masque_at is null
          and p.statut <> 'mort'
          and not (af.statut = 'perdu' and coalesce(af.perdu_at, af.updated_at) < now() - interval '15 days')
      ) sub
    ),

    -- Espace « Perdus » : tout ce qui est sorti du pipe ci-dessus, à
    -- l'exception des projets déclarés morts par l'agence — inutile de
    -- proposer à l'artisan de récupérer un lead parti chez un concurrent.
    -- `restaurable` indique s'il peut le remettre dans son pipe lui-même.
    'projets_perdus', (
      select coalesce(json_agg(p_json order by sorti_le desc), '[]'::json)
      from (
        select
          coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis,
            'client_ville', p.client_ville,
            'sorti_le', coalesce(af.retire_at, af.perdu_at, af.updated_at),
            'motif', case
                       when af.retire_at is not null then 'retrait'
                       when af.statut = 'perdu'      then 'perdu'
                       else 'masque' end,
            -- Un chantier repris par un autre artisan n'est plus récupérable.
            'restaurable', (p.statut <> 'mort' and p.deleted_at is null
                            and (p.artisan_id is null or p.artisan_id = af.artisan_id)),
            'derniere_raison', (
              select s.message from public.suivis s
               where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
               order by s.created_at desc limit 1
            )
          ) as p_json
        from public.affectations af
        join public.projets p on p.id = af.projet_id
        where af.artisan_id = a.id
          and p.deleted_at is null
          and p.statut <> 'mort'
          and (
            af.retire_at is not null
            or af.masque_at is not null
            or (af.statut = 'perdu'
                and coalesce(af.perdu_at, af.updated_at) < now() - interval '15 days')
          )
      ) sub
    )
  );
end;
$function$;

-- ---------- 5. Remettre un chantier perdu dans son pipe ----------
-- Cas d'usage : le client recontacte l'artisan après coup. Il récupère le
-- chantier lui-même, sans passer par l'agence, mais celle-ci est notifiée.
create or replace function public.restaurer_chantier_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  af public.affectations;
  p  public.projets;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  select * into p from public.projets where id = af.projet_id;

  -- Un projet mort ou supprimé ne se récupère pas : décision d'agence.
  if p.id is null or p.deleted_at is not null or p.statut = 'mort' then
    return json_build_object('ok', false, 'error', 'projet_clos');
  end if;

  -- Ni un chantier déjà repris par un CONFRÈRE.
  if p.artisan_id is not null and p.artisan_id <> af.artisan_id then
    return json_build_object('ok', false, 'error', 'deja_attribue');
  end if;

  update public.affectations
     set statut     = 'artisan_assigne',
         retire_at  = null,
         perdu_at   = null,
         masque_at  = null
   where id = af.id;

  -- Le projet ne redevient actif que s'il n'a pas déjà avancé avec quelqu'un.
  update public.projets
     set statut = 'artisan_assigne'
   where id = af.projet_id
     and statut in ('nouveau', 'a_rappeler', 'perdu');

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'note', null,
          'Chantier remis dans le pipe par l''artisan (client recontacté).');

  insert into public.notifications (type, titre, message, projet_id)
  values ('chantier_restaure',
    'Chantier repris : ' || coalesce(p.client_nom, 'chantier'),
    coalesce((select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'Un artisan')
      || ' a remis ce chantier dans son pipe.',
    af.projet_id);

  return json_build_object('ok', true);
end;
$function$;

revoke execute on function public.restaurer_chantier_by_token(text) from public;
grant  execute on function public.restaurer_chantier_by_token(text) to anon, authenticated;
