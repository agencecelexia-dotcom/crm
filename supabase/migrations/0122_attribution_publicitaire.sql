-- ============================================================
--  0122 — Attribution publicitaire des leads.
-- ============================================================
--
-- LE PROBLÈME
--
-- La landing capture DÉJÀ tout ce qu'il faut : `gclid`, `gbraid`, `wbraid`,
-- `fbclid`, `msclkid` et les `utm_*`, persistés 90 jours dans le cookie `_attr`
-- (landing/src/lib/attribution.ts), puis aplatis à la racine de la charge
-- envoyée au webhook par `construireCharge` (landing/src/lib/server/lead.ts).
--
-- Mais `ingerer_lead_externe` (0097) n'a AUCUNE colonne pour les recevoir.
-- L'attribution est donc captée par la landing, transportée jusqu'ici, et jetée
-- au moment de l'insertion.
--
-- Conséquence directe, mesurable aujourd'hui : on ne sait pas ce que coûte un
-- lead toiture dans le 78, ni ce qu'il rapporte une fois le devis signé. La
-- dépense publicitaire et le chiffre d'affaires vivent dans deux mondes qui ne
-- se rencontrent jamais.
--
-- LA SOLUTION
--
-- Les colonnes d'attribution sur `projets`, et une `ingerer_lead_externe` qui
-- les lit. Tout reste OPTIONNEL : le workflow LSA (0097), qui n'envoie aucun de
-- ces champs, continue de fonctionner sans la moindre modification.
--
-- LA CLÉ DE JOINTURE — le point important
--
-- `utm_campaign` porte l'IDENTIFIANT NATIF de la campagne, jamais son libellé :
-- les annonces Meta utilisent `utm_campaign={{campaign.id}}` et Google Ads
-- `utm_campaign={campaignid}`. Un renommage de campagne ne casse donc pas
-- l'historique — ce qu'un rattachement par nom ferait, et en silence.

-- ---------- 1) Les colonnes ----------

alter table public.projets
  -- Paramètres de campagne. `utm_campaign` est la clé de jointure vers ads.campagnes.
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text,
  -- Identifiants de clic. Servent au renvoi de conversion (Enhanced Conversions,
  -- Meta CAPI) et de repli d'attribution quand les utm sont absents.
  add column if not exists gclid   text,
  add column if not exists gbraid  text,
  add column if not exists wbraid  text,
  add column if not exists fbclid  text,
  add column if not exists msclkid text,
  -- Contexte d'arrivée.
  add column if not exists landing_path text,
  add column if not exists referrer     text,
  -- Identifiant d'événement partagé Pixel ↔ Conversions API, pour la déduplication.
  add column if not exists event_id     text,
  -- Qualification calculée par la landing.
  add column if not exists lead_score    text,
  add column if not exists hors_zone     boolean,
  add column if not exists suspected_bot boolean,
  -- Quand l'attribution a été enregistrée. Null = lead sans origine publicitaire
  -- connue (saisie manuelle, LSA, appel entrant).
  add column if not exists attribution_captee_le timestamptz;

comment on column public.projets.utm_campaign is
  'IDENTIFIANT NATIF de la campagne chez la régie, pas son nom : les annonces '
  'portent utm_campaign={{campaign.id}} (Meta) ou {campaignid} (Google Ads). '
  'Clé de jointure vers ads.campagnes.campagne_native_id — insensible aux renommages.';

comment on column public.projets.lead_score is
  'Note attribuée par la landing : A, B ou C. Un C ne déclenche pas de '
  'conversion publicitaire, pour que les algorithmes n''optimisent pas vers le déchet.';

comment on column public.projets.attribution_captee_le is
  'Horodatage de l''enregistrement de l''attribution. Null = origine publicitaire '
  'inconnue (saisie manuelle, LSA, appel entrant).';

-- ---------- 2) Les index ----------
--
-- Partiels : la majorité des leads historiques n'a aucune attribution, il n'y a
-- aucune raison de les indexer.

create index if not exists idx_projets_utm_campaign
  on public.projets (utm_campaign)
  where utm_campaign is not null;

create index if not exists idx_projets_gclid
  on public.projets (gclid)
  where gclid is not null;

create index if not exists idx_projets_fbclid
  on public.projets (fbclid)
  where fbclid is not null;

-- ---------- 3) Le rattrapage d'attribution ----------

/**
 * Renseigne l'attribution d'un lead déjà en base, sans jamais écraser.
 *
 * POURQUOI : un client peut appeler le numéro LSA puis remplir le formulaire de
 * la landing une heure plus tard. Le second passage est dédoublonné sur le
 * téléphone — et sans ce rattrapage, son attribution publicitaire serait perdue
 * alors que c'est précisément elle qui explique la dépense.
 *
 * `coalesce(colonne, nouveau)` et non l'inverse : le PREMIER signal d'origine
 * gagne. Écraser reviendrait à ré-attribuer un lead à la dernière campagne vue,
 * ce qui gonflerait mécaniquement les campagnes de retargeting.
 */
create or replace function public.completer_attribution(
  p_projet_id uuid,
  p_lead jsonb,
  p_a_attribution boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not p_a_attribution then return; end if;

  update public.projets set
    utm_source   = coalesce(utm_source,   nullif(btrim(p_lead->>'utm_source'),   '')),
    utm_medium   = coalesce(utm_medium,   nullif(btrim(p_lead->>'utm_medium'),   '')),
    utm_campaign = coalesce(utm_campaign, nullif(btrim(p_lead->>'utm_campaign'), '')),
    utm_content  = coalesce(utm_content,  nullif(btrim(p_lead->>'utm_content'),  '')),
    utm_term     = coalesce(utm_term,     nullif(btrim(p_lead->>'utm_term'),     '')),
    gclid        = coalesce(gclid,        nullif(btrim(p_lead->>'gclid'),        '')),
    gbraid       = coalesce(gbraid,       nullif(btrim(p_lead->>'gbraid'),       '')),
    wbraid       = coalesce(wbraid,       nullif(btrim(p_lead->>'wbraid'),       '')),
    fbclid       = coalesce(fbclid,       nullif(btrim(p_lead->>'fbclid'),       '')),
    msclkid      = coalesce(msclkid,      nullif(btrim(p_lead->>'msclkid'),      '')),
    landing_path = coalesce(landing_path, nullif(btrim(p_lead->>'landing_path'), '')),
    referrer     = coalesce(referrer,     nullif(btrim(p_lead->>'referrer'),     '')),
    event_id     = coalesce(event_id,     nullif(btrim(p_lead->>'event_id'),     '')),
    lead_score   = coalesce(lead_score,   nullif(btrim(p_lead->>'lead_score'),   '')),
    attribution_captee_le = coalesce(attribution_captee_le, now())
  where id = p_projet_id
    -- Ne rien écrire si toutes les colonnes visées sont déjà remplies.
    and attribution_captee_le is null;
end;
$$;

comment on function public.completer_attribution(uuid, jsonb, boolean) is
  'Renseigne l''attribution d''un lead déjà en base sans jamais écraser : le '
  'premier signal d''origine gagne. Appelée par ingerer_lead_externe sur les '
  'deux chemins de déduplication.';

-- ---------- 4) L'ingestion ----------

/**
 * Crée un lead venu d'une source externe, sans jamais dupliquer.
 *
 * Renvoie toujours l'identifiant du projet — créé ou déjà existant — pour que
 * l'appelant n'ait pas à distinguer les deux cas.
 *
 * Inchangé depuis 0097 : l'idempotence stricte sur `source_ref` et le repli sur
 * le téléphone à 30 jours. Ajouté ici : la persistance de l'attribution
 * publicitaire, et son rattrapage sur un lead déjà connu.
 */
create or replace function public.ingerer_lead_externe(p_lead jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source     text := coalesce(nullif(btrim(p_lead->>'source'), ''), 'externe');
  v_ref        text := nullif(btrim(p_lead->>'source_ref'), '');
  v_tel        text := regexp_replace(coalesce(p_lead->>'telephone', ''), '\D', '', 'g');
  v_nom        text := nullif(btrim(p_lead->>'nom'), '');
  v_metier     text := nullif(btrim(p_lead->>'metier'), '');
  v_id         uuid;
  v_existant   uuid;
  -- Vrai dès qu'au moins un signal d'origine publicitaire est présent. Sert à
  -- ne pas horodater une attribution vide.
  v_a_attribution boolean := (
       nullif(btrim(p_lead->>'utm_campaign'), '') is not null
    or nullif(btrim(p_lead->>'utm_source'),   '') is not null
    or nullif(btrim(p_lead->>'gclid'),        '') is not null
    or nullif(btrim(p_lead->>'gbraid'),       '') is not null
    or nullif(btrim(p_lead->>'wbraid'),       '') is not null
    or nullif(btrim(p_lead->>'fbclid'),       '') is not null
    or nullif(btrim(p_lead->>'msclkid'),      '') is not null
  );
begin
  -- Un numéro français a 10 chiffres. Les formats internationaux (+33…)
  -- arrivent parfois sur 11 ou 12 : on les ramène au format national.
  if length(v_tel) = 11 and left(v_tel, 2) = '33' then
    v_tel := '0' || substring(v_tel from 3);
  elsif length(v_tel) = 12 and left(v_tel, 3) = '033' then
    v_tel := '0' || substring(v_tel from 4);
  end if;
  if length(v_tel) <> 10 then v_tel := null; end if;

  -- 1. Idempotence stricte : même source, même référence.
  if v_ref is not null then
    select id into v_existant
      from public.projets
     where source = v_source and source_ref = v_ref
     limit 1;
    if v_existant is not null then
      perform public.completer_attribution(v_existant, p_lead, v_a_attribution);
      return json_build_object('ok', true, 'projet_id', v_existant, 'cree', false,
                               'raison', 'reference_deja_vue');
    end if;
  end if;

  -- 2. Repli : même numéro reçu récemment. Au-delà de 30 jours, un client qui
  --    recontacte est une nouvelle demande, pas un doublon.
  if v_tel is not null then
    select id into v_existant
      from public.projets
     where deleted_at is null
       and regexp_replace(coalesce(client_telephone, ''), '\D', '', 'g') = v_tel
       and created_at > now() - interval '30 days'
     order by created_at desc
     limit 1;
    if v_existant is not null then
      perform public.completer_attribution(v_existant, p_lead, v_a_attribution);
      return json_build_object('ok', true, 'projet_id', v_existant, 'cree', false,
                               'raison', 'telephone_deja_present');
    end if;
  end if;

  -- Sans téléphone ni nom, la fiche serait inexploitable : autant le signaler
  -- que de créer un dossier vide que personne ne pourra traiter.
  if v_tel is null and v_nom is null then
    return json_build_object('ok', false, 'error', 'ni_telephone_ni_nom');
  end if;

  insert into public.projets (
    client_nom, client_telephone, client_email,
    client_adresse, client_ville, client_code_postal,
    metier, metiers, statut, description, source, source_ref,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    gclid, gbraid, wbraid, fbclid, msclkid,
    landing_path, referrer, event_id,
    lead_score, hors_zone, suspected_bot, attribution_captee_le
  ) values (
    coalesce(v_nom, v_tel, 'À qualifier'),
    v_tel,
    nullif(btrim(p_lead->>'email'), ''),
    nullif(btrim(p_lead->>'adresse'), ''),
    nullif(btrim(p_lead->>'ville'), ''),
    nullif(btrim(p_lead->>'code_postal'), ''),
    coalesce(v_metier, 'Rénovation'),
    array[coalesce(v_metier, 'Rénovation')],
    -- « nouveau » et non « a_rappeler » : le lead n'a pas encore été appelé,
    -- il entre dans le flux normal de qualification.
    'nouveau',
    -- La landing nomme ce champ `message`, le workflow LSA `description`.
    -- Accepter les deux évite de perdre le besoin exprimé par le client selon
    -- le chemin d'entrée.
    coalesce(nullif(btrim(p_lead->>'description'), ''),
             nullif(btrim(p_lead->>'message'), '')),
    v_source,
    v_ref,
    nullif(btrim(p_lead->>'utm_source'),   ''),
    nullif(btrim(p_lead->>'utm_medium'),   ''),
    nullif(btrim(p_lead->>'utm_campaign'), ''),
    nullif(btrim(p_lead->>'utm_content'),  ''),
    nullif(btrim(p_lead->>'utm_term'),     ''),
    nullif(btrim(p_lead->>'gclid'),        ''),
    nullif(btrim(p_lead->>'gbraid'),       ''),
    nullif(btrim(p_lead->>'wbraid'),       ''),
    nullif(btrim(p_lead->>'fbclid'),       ''),
    nullif(btrim(p_lead->>'msclkid'),      ''),
    nullif(btrim(p_lead->>'landing_path'), ''),
    nullif(btrim(p_lead->>'referrer'),     ''),
    nullif(btrim(p_lead->>'event_id'),     ''),
    nullif(btrim(p_lead->>'lead_score'),   ''),
    nullif(btrim(p_lead->>'hors_zone'), '')::boolean,
    nullif(btrim(p_lead->>'suspected_bot'), '')::boolean,
    case when v_a_attribution then now() end
  )
  returning id into v_id;

  return json_build_object('ok', true, 'projet_id', v_id, 'cree', true);
end;
$$;

comment on function public.ingerer_lead_externe(jsonb) is
  'Crée un lead venu d''une source externe (LSA, landing, Meta Lead Ads) sans '
  'doublon. Idempotent sur source_ref, avec repli sur le téléphone à 30 jours. '
  'Persiste l''attribution publicitaire et la rattrape sur un lead déjà connu.';

-- Réservées au service_role : c'est n8n ou une Edge Function qui appelle,
-- jamais un navigateur.
revoke execute on function public.ingerer_lead_externe(jsonb) from public, anon, authenticated;
grant  execute on function public.ingerer_lead_externe(jsonb) to service_role;

revoke execute on function public.completer_attribution(uuid, jsonb, boolean) from public, anon, authenticated;
grant  execute on function public.completer_attribution(uuid, jsonb, boolean) to service_role;
