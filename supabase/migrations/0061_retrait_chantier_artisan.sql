-- ============================================================
--  0061 — L'artisan peut se RETIRER d'un chantier depuis son espace.
--
--  Besoin : un artisan qui ne veut plus d'un dossier doit pouvoir le sortir
--  de son espace lui-même, sans passer par l'agence.
--
--  Ce que ça n'est PAS : une suppression du projet. Un projet peut être
--  affecté à plusieurs artisans, et affectations.projet_id est en
--  ON DELETE CASCADE (0024:8) — laisser un artisan supprimer la ligne
--  `projets` détruirait les données client de l'agence et le travail des
--  autres artisans. Le retrait ne touche donc QUE son affectation.
--
--  Effets :
--    - l'affectation passe à 'perdu' et reçoit retire_at = now()
--    - elle disparaît de l'espace de l'artisan (filtre dans get_espace_artisan)
--    - l'agence garde toute la trace : suivi horodaté + justification obligatoire
--    - notification interne + webhook n8n
--    - le statut du projet est recalculé (même logique que 0058)
--
--  Garde-fou anti-mauvais-clic : justification écrite obligatoire, vérifiée
--  côté serveur (le front impose en plus une confirmation explicite).
-- ============================================================

-- ---------- 1) Marqueur de retrait ----------
-- On ne supprime pas la ligne : l'agence doit pouvoir constater qui s'est
-- retiré, quand et pourquoi (et le scoring artisan doit continuer d'en tenir
-- compte). Le retrait est donc un masquage côté artisan, pas un effacement.
alter table public.affectations
  add column if not exists retire_at timestamptz;

create index if not exists idx_affectations_retire
  on public.affectations (artisan_id) where retire_at is null;

-- ---------- 2) RPC de retrait ----------
create or replace function public.retirer_chantier_by_token(
  p_token text,
  p_raison text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  af public.affectations;
  v_restants int;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  -- Idempotent : un second appel ne rejoue ni la notification ni le webhook.
  if af.retire_at is not null then
    return json_build_object('ok', true, 'deja_retire', true);
  end if;

  -- Justification obligatoire (au moins 5 caractères utiles) : c'est la
  -- vérification serveur du garde-fou anti-mauvais-clic.
  if length(coalesce(btrim(p_raison), '')) < 5 then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;

  -- Trace pour l'agence, avant toute modification d'état.
  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'retrait', 'perdu', btrim(p_raison));

  update public.affectations
     set statut = 'perdu', retire_at = now()
   where id = af.id;

  -- Recalcul du statut projet : même logique que add_suivi_by_token (0058),
  -- avec le classement complété (a_rappeler / en_attente y manquaient).
  select count(*) into v_restants
    from public.affectations af2
   where af2.projet_id = af.projet_id
     and af2.statut <> 'perdu'
     and af2.retire_at is null;

  if v_restants > 0 then
    -- Au moins un artisan encore actif : le projet prend le meilleur statut actif.
    update public.projets p set statut = (
      select af2.statut from public.affectations af2
       where af2.projet_id = p.id and af2.statut <> 'perdu' and af2.retire_at is null
       order by case af2.statut
         when 'termine'      then 6
         when 'devis_signe'  then 5
         when 'devis_envoye' then 4
         when 'rdv_pris'     then 3
         when 'en_attente'   then 2
         when 'contacte'     then 1
         when 'a_rappeler'   then 1
         else 0 end desc
       limit 1)
    where p.id = af.projet_id;
  else
    -- Plus aucun artisan actif : le dossier remonte dans la pile à attribuer.
    -- On remet AUSSI les montants à null : la commission de `projets` est une
    -- colonne générée à partir de montant_devis_signe. Sans ce reset, un projet
    -- sans artisan continuerait de compter sa commission au tableau de bord
    -- (c'est le défaut A3-04 relevé à l'audit, que 0058 laisse passer).
    update public.projets
       set statut = 'nouveau',
           artisan_id = null,
           montant_devis_signe = null,
           montant_devis = null
     where id = af.projet_id;

    insert into public.notifications (type, titre, message, projet_id)
    values (
      'a_reassigner',
      'À réassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
      'L''artisan s''est retiré du chantier. Raison : ' || btrim(p_raison),
      af.projet_id
    );
  end if;

  -- Notification interne systématique : l'agence doit savoir même si
  -- d'autres artisans restent sur le dossier.
  insert into public.notifications (type, titre, message, projet_id)
  values (
    'artisan_retrait',
    'Retrait artisan : ' || coalesce(
      (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
      'artisan'),
    btrim(p_raison),
    af.projet_id
  );

  perform net.http_post(
    url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'artisan_retrait',
      'artisan', (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
      'client_nom', (select p.client_nom from public.projets p where p.id = af.projet_id),
      'client_ville', (select p.client_ville from public.projets p where p.id = af.projet_id),
      'metier', (select p.metier from public.projets p where p.id = af.projet_id),
      'raison', btrim(p_raison),
      'restants', v_restants,
      'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
    )
  );

  return json_build_object('ok', true, 'restants', v_restants);
end;
$function$;

-- Exposition explicite (et uniquement celle-là) : l'artisan n'a pas de compte,
-- il appelle en tant qu'anon avec le token de son affectation.
revoke execute on function public.retirer_chantier_by_token(text, text) from public;
grant  execute on function public.retirer_chantier_by_token(text, text) to anon, authenticated;

comment on function public.retirer_chantier_by_token(text, text) is
  'Retrait volontaire d''un artisan d''un chantier, via le token de son affectation. '
  'Ne supprime jamais le projet : masque l''affectation (retire_at) et la passe à perdu. '
  'Justification >= 5 caractères obligatoire.';

-- ---------- 3) get_espace_artisan : masque les chantiers retirés ----------
-- Repris de 0060 à l'identique, seul le WHERE change (ajout de af.retire_at is null).
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
            'commission', p.commission,
            'commission_encaissee', p.commission_encaissee,
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
          and af.retire_at is null      -- ← 0061 : masque les chantiers retirés
      ) sub
    )
  );
end;
$function$;

-- 0060 n'avait pas réémis de grant après son create or replace ; on le pose
-- explicitement ici (cf. audit A1-02 : sans grant, EXECUTE reste ouvert à PUBLIC).
revoke execute on function public.get_espace_artisan(text) from public;
grant  execute on function public.get_espace_artisan(text) to anon, authenticated;
