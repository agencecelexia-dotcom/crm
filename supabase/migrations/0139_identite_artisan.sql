-- L'identité de l'entreprise, saisie une fois, portée par tous les devis.
--
-- CE QUI MANQUAIT
--
-- Le PDF affiche un logo EN DUR (`/logo-metbach.png`) et un bloc de mentions
-- réduit à trois lignes. Un devis du bâtiment destiné à un particulier doit en
-- porter bien davantage : immatriculation, capital, TVA intracommunautaire,
-- assurance décennale et sa couverture géographique, modalités de paiement,
-- pénalités de retard, médiateur de la consommation, droit de rétractation.
--
-- Un devis incomplet est un devis attaquable, et le client qui compare trois
-- artisans écarte d'abord celui dont le document fait amateur.
--
-- LE PRINCIPE
--
-- L'artisan renseigne son entreprise UNE FOIS. Tous ses devis en héritent :
-- il ne doit jamais avoir à retaper son numéro de police d'assurance.
--
-- Les champs déjà présents sur la fiche (`forme_juridique`, `capital_social`,
-- `siren`, `ville_immatriculation`) sont réutilisés tels quels. On n'ajoute
-- que ce qui manque vraiment.

alter table public.artisans
  add column if not exists logo_url            text,
  add column if not exists tva_intracom        text,
  add column if not exists code_ape            text,
  add column if not exists iban                text,
  add column if not exists bic                 text,
  add column if not exists mediateur_nom       text,
  add column if not exists mediateur_url       text,
  add column if not exists cgv                 text,
  add column if not exists conditions_paiement text,
  add column if not exists garantie_zone       text,
  add column if not exists acompte_defaut      int,
  add column if not exists tva_mode_defaut     text;

comment on column public.artisans.cgv is
  'Conditions générales imprimées en dernière page du devis. Nulles = celles '
  'de `cgv_par_defaut()`, que l''artisan peut reprendre et amender.';

comment on column public.artisans.garantie_zone is
  'Couverture géographique de la décennale — mention obligatoire au devis, '
  'et première chose que vérifie un assureur en cas de sinistre hors zone.';

-- ---------- Des CGV par défaut, pour n'avoir pas à les écrire ----------
--
-- Rédigées pour un marché de travaux conclu avec un PARTICULIER. Les règles
-- diffèrent entre professionnels : l'indemnité forfaitaire de recouvrement de
-- 40 € (art. L.441-10 du code de commerce) ne s'applique pas ici, et le délai
-- de rétractation de 14 jours n'existe que pour un contrat conclu hors
-- établissement — ce qui est le cas d'un devis signé chez le client.

create or replace function public.cgv_par_defaut()
returns text
language sql
immutable
set search_path to 'pg_temp'
as $function$
select
'1. OBJET ET VALIDITÉ
Le présent devis décrit les travaux convenus entre l''entreprise et le client. Il est valable un mois à compter de sa date d''émission. Passé ce délai, les prix sont susceptibles d''être révisés. Sa signature vaut acceptation pleine et entière des travaux décrits et des présentes conditions.

2. PRIX
Les prix sont exprimés en euros et fermes pour la durée de validité du devis. Ils comprennent la fourniture et la pose des éléments décrits, à l''exclusion de toute prestation non mentionnée. Tout travail supplémentaire demandé en cours de chantier fera l''objet d''un avenant écrit et chiffré, accepté avant exécution.

3. CONDITIONS D''EXÉCUTION
Le client met à disposition les accès, l''eau et l''électricité nécessaires. Il signale toute particularité du support ou toute canalisation enterrée avant le démarrage. La découverte en cours de chantier d''un désordre non visible lors de la visite (support dégradé, amiante, plomb, réseau non signalé) suspend les travaux et donne lieu à un avenant.

4. PAIEMENT
Un acompte est versé à la commande, le solde à la réception des travaux. Aucun escompte n''est accordé pour paiement anticipé. En cas de retard, des intérêts au taux d''intérêt légal en vigueur courent de plein droit, sans mise en demeure préalable.

5. DÉLAIS
Les délais annoncés sont donnés à titre indicatif et courent à compter de l''encaissement de l''acompte. Ils sont suspendus par les intempéries, l''indisponibilité d''un approvisionnement, ou tout fait du client faisant obstacle à l''avancement.

6. RÉCEPTION DES TRAVAUX
La réception est prononcée contradictoirement à l''achèvement, avec ou sans réserves. Les réserves éventuelles sont levées dans un délai convenu entre les parties. La prise de possession des lieux sans réserve vaut réception.

7. GARANTIES
Les travaux bénéficient de la garantie de parfait achèvement d''un an, de la garantie de bon fonctionnement de deux ans sur les éléments d''équipement dissociables, et de la garantie décennale sur les ouvrages de construction, dans les conditions des articles 1792 et suivants du code civil.

8. DROIT DE RÉTRACTATION
Lorsque le contrat est conclu hors de l''établissement de l''entreprise, notamment au domicile du client, celui-ci dispose d''un délai de quatorze jours pour se rétracter sans motif ni pénalité (article L.221-18 du code de la consommation). Le client qui souhaite une exécution avant l''expiration de ce délai en fait la demande expresse et par écrit.

9. ASSURANCE
L''entreprise justifie des assurances de responsabilité civile professionnelle et de responsabilité décennale mentionnées au présent devis, pour la nature des travaux et la zone géographique qui y figurent.

10. MÉDIATION ET LITIGES
Conformément à l''article L.612-1 du code de la consommation, le client peut recourir gratuitement au médiateur de la consommation dont les coordonnées figurent au présent devis, en vue de la résolution amiable d''un litige. À défaut d''accord, les tribunaux français sont seuls compétents.

11. DONNÉES PERSONNELLES
Les informations recueillies servent exclusivement à l''exécution du présent marché et à la gestion de la relation commerciale. Le client dispose d''un droit d''accès, de rectification et d''effacement en s''adressant à l''entreprise.';
$function$;

revoke execute on function public.cgv_par_defaut() from public;
grant execute on function public.cgv_par_defaut() to anon, authenticated;

-- ---------- Le dépôt du logo ----------
--
-- Dans le bucket public `devis`, sous `logos/<jeton artisan>/`. Le premier
-- segment fixe l'usage, le second autorise l'écriture — le motif déjà retenu
-- pour les attestations (0131) et les devis (0058).
--
-- Chaque dépôt porte un nom neuf : sans écrasement, la politique n'a pas
-- besoin d'autoriser l'UPDATE, qui ouvrirait la modification de l'existant.

do $$
begin
  drop policy if exists devis_logo_token on storage.objects;
  create policy devis_logo_token on storage.objects
    for insert to anon
    with check (
      bucket_id = 'devis'
      and split_part(name, '/', 1) = 'logos'
      and public.token_artisan_valide(split_part(name, '/', 2))
    );
end $$;

-- ---------- Lire son identité ----------

create or replace function public.identite_by_token(p_token text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare a public.artisans;
begin
  select * into a from public.artisans where token = p_token and ecarte_at is null;
  if a.id is null then return null; end if;

  return json_build_object(
    'societe',        coalesce(a.societe, trim(coalesce(a.prenom,'') || ' ' || coalesce(a.nom,''))),
    'adresse',        a.adresse,
    'code_postal',    a.code_postal,
    'ville',          a.ville,
    'telephone',      a.telephone,
    'email',          a.email,
    'siren',          a.siren,
    'forme_juridique', a.forme_juridique,
    'capital_social', a.capital_social,
    'ville_immatriculation', a.ville_immatriculation,
    'representant',   a.representant,
    'logo_url',       a.logo_url,
    'tva_intracom',   a.tva_intracom,
    'code_ape',       a.code_ape,
    'iban',           a.iban,
    'bic',            a.bic,
    'mediateur_nom',  a.mediateur_nom,
    'mediateur_url',  a.mediateur_url,
    'cgv',            coalesce(a.cgv, public.cgv_par_defaut()),
    'cgv_personnalisees', a.cgv is not null,
    'conditions_paiement', a.conditions_paiement,
    'garantie_zone',  a.garantie_zone,
    'acompte_defaut', a.acompte_defaut,
    'tva_mode_defaut', a.tva_mode_defaut,
    'assurance', json_build_object(
      'decennale_assureur', a.assurance_decennale_assureur,
      'decennale_police',   a.assurance_decennale_police,
      'decennale_echeance', a.assurance_decennale_echeance,
      'rc_pro_assureur',    a.assurance_rc_pro_assureur,
      'rc_pro_police',      a.assurance_rc_pro_police),
    -- Ce qui reste à remplir pour qu'un devis soit irréprochable. Affiché tel
    -- quel dans l'espace : une liste vaut mieux qu'un pourcentage.
    'manquants', (
      select coalesce(json_agg(m), '[]'::json) from (
        select 'Logo'                      m where coalesce(a.logo_url,'') = ''
        union all select 'Adresse'           where coalesce(a.adresse,'') = ''
        union all select 'SIREN'             where coalesce(a.siren,'') = ''
        union all select 'Forme juridique'   where coalesce(a.forme_juridique,'') = ''
        union all select 'Ville d''immatriculation' where coalesce(a.ville_immatriculation,'') = ''
        union all select 'Assurance décennale'      where coalesce(a.assurance_decennale_assureur,'') = ''
        union all select 'Zone de garantie décennale' where coalesce(a.garantie_zone,'') = ''
        union all select 'Médiateur de la consommation' where coalesce(a.mediateur_nom,'') = ''
        union all select 'IBAN'              where coalesce(a.iban,'') = ''
      ) t)
  );
end
$function$;

revoke execute on function public.identite_by_token(text) from public;
grant execute on function public.identite_by_token(text) to anon, authenticated;

-- ---------- L'enregistrer ----------
--
-- Une seule fonction qui prend le bloc complet : l'écran d'identité est un
-- formulaire, pas une suite de champs indépendants. Les clés absentes du
-- payload laissent la valeur en place.

create or replace function public.enregistrer_identite_by_token(p_token text, p_payload jsonb)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_tva text;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  v_tva := nullif(btrim(coalesce(p_payload->>'tva_mode_defaut', '')), '');
  if v_tva is not null and v_tva not in ('franchise', 'normal') then
    return json_build_object('ok', false, 'error', 'tva_mode_invalide');
  end if;

  update public.artisans set
    societe               = coalesce(nullif(btrim(p_payload->>'societe'), ''), societe),
    adresse               = coalesce(nullif(btrim(p_payload->>'adresse'), ''), adresse),
    code_postal           = coalesce(nullif(btrim(p_payload->>'code_postal'), ''), code_postal),
    ville                 = coalesce(nullif(btrim(p_payload->>'ville'), ''), ville),
    telephone             = coalesce(nullif(btrim(p_payload->>'telephone'), ''), telephone),
    email                 = coalesce(nullif(btrim(p_payload->>'email'), ''), email),
    siren                 = coalesce(nullif(btrim(p_payload->>'siren'), ''), siren),
    forme_juridique       = coalesce(nullif(btrim(p_payload->>'forme_juridique'), ''), forme_juridique),
    capital_social        = coalesce(nullif(btrim(p_payload->>'capital_social'), ''), capital_social),
    ville_immatriculation = coalesce(nullif(btrim(p_payload->>'ville_immatriculation'), ''), ville_immatriculation),
    logo_url              = coalesce(nullif(btrim(p_payload->>'logo_url'), ''), logo_url),
    tva_intracom          = coalesce(nullif(btrim(p_payload->>'tva_intracom'), ''), tva_intracom),
    code_ape              = coalesce(nullif(btrim(p_payload->>'code_ape'), ''), code_ape),
    iban                  = coalesce(nullif(btrim(p_payload->>'iban'), ''), iban),
    bic                   = coalesce(nullif(btrim(p_payload->>'bic'), ''), bic),
    mediateur_nom         = coalesce(nullif(btrim(p_payload->>'mediateur_nom'), ''), mediateur_nom),
    mediateur_url         = coalesce(nullif(btrim(p_payload->>'mediateur_url'), ''), mediateur_url),
    conditions_paiement   = coalesce(nullif(btrim(p_payload->>'conditions_paiement'), ''), conditions_paiement),
    garantie_zone         = coalesce(nullif(btrim(p_payload->>'garantie_zone'), ''), garantie_zone),
    acompte_defaut        = coalesce(nullif(p_payload->>'acompte_defaut', '')::int, acompte_defaut),
    tva_mode_defaut       = coalesce(v_tva, tva_mode_defaut),
    -- Les CGV sont le seul champ qu'on accepte de REMETTRE À ZÉRO : renvoyer
    -- une chaîne vide, c'est demander à revenir aux conditions par défaut.
    cgv                   = case
                              when p_payload ? 'cgv'
                              then nullif(btrim(p_payload->>'cgv'), '')
                              else cgv
                            end
  where id = v_id;

  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.enregistrer_identite_by_token(text, jsonb) from public;
grant execute on function public.enregistrer_identite_by_token(text, jsonb) to anon, authenticated;
