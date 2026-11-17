-- Aucun accès aux chantiers avant la signature du contrat.
--
-- Jusqu'ici, un artisan qui n'avait pas signé voyait déjà la liste de ses
-- chantiers : ville, métier, description, budget et photos. Seuls le nom, le
-- téléphone et l'adresse du client étaient masqués. Deux fonctions laissaient
-- en plus filer, sans signature, la position exacte de la maison (coordonnées
-- GPS et bâtiment retenu, via le métré) et les échanges du chantier (via le
-- contexte du devis) ; une troisième listait les documents partagés.
--
-- Désormais, avant signature, l'espace ne renvoie que le contrat et le NOMBRE
-- de chantiers en attente. Les actions étaient déjà refusées
-- (acces_suivi_par_jeton → 'contrat_requis') ; les lectures le sont aussi.
-- Un contrat externe (enregistré par l'agence) vaut signature, comme avant.
--
-- Chaque fonction reprend sa dernière définition ; seuls les blocs marqués
-- « 0200 » changent.

CREATE OR REPLACE FUNCTION public.get_espace_artisan(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
  v_res json;
  v_nb integer;
begin
  -- Garde-fou 0156 : un artisan écarté perd tout accès.
  if public.acces_par_jeton(p_token, false) is not null then
    -- Même réponse qu'un jeton inconnu : l'écran affiche « lien invalide »
    -- au lieu de tenter de dessiner un espace à partir d'un message d'erreur.
    return null;
  end if;
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  c := public.ensure_engagement_contrat(a.id);
  v_signe := (c.statut = 'signe') or a.contrat_externe;

  v_res := json_build_object(
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
    -- KPI calculés sur les FAITS (étape atteinte, issue, montants) et non
    -- plus sur `statut`, qui était écrasable. Voir 0075/0076.
    'stats', public.stats_artisan_faits(a.id),

    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          case af.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            -- Deux axes séparés : l'étape ne recule plus, l'attente
            -- est un drapeau daté et non plus un statut qui écrase.
            'etape', af.etape, 'issue', af.issue,
            'en_attente_depuis', af.en_attente_depuis,
            'rappel_le', af.rappel_le,
            'recu_le', coalesce(af.created_at, p.created_at),
            'derniere_activite', greatest(af.updated_at, (select max(s.created_at) from public.suivis s where s.affectation_id = af.id)),
            'date_rdv', af.date_rdv,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis, 'montant_devis_signe', af.montant_devis_signe,
            'commission', case when p.artisan_id = af.artisan_id then p.commission end,
            'commission_encaissee',
              case when p.artisan_id = af.artisan_id then p.commission_encaissee else false end,
            'client_ville', p.client_ville, 'photos', coalesce(p.photos, '{}'),
            'devis_depose', af.devis_url is not null,
            'devis_signe_depose', af.devis_signe_url is not null,
            -- URLs des PDF déposés : l'artisan doit pouvoir RELIRE ce qu'il a
            -- envoyé, pas seulement savoir qu'un fichier existe.
            'devis_url', case when v_signe then af.devis_url end,
            'devis_signe_url', case when v_signe then af.devis_signe_url end,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'non_lus', (select count(*) from public.suivis s2
                        where s2.affectation_id = af.id
                          and s2.auteur = 'agence' and s2.lu_at is null),
            'suivis', case when v_signe then (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                -- Le fil devient bidirectionnel : l'artisan distingue enfin
                -- une consigne de l'agence de sa propre saisie (0080).
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            ) else '[]'::json end
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
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_code_postal', case when v_signe then p.client_code_postal end,
            'motif_perte', af.motif_perte,
            -- Ce qui manquait pour décider d'une réattribution : l'HISTORIQUE.
            -- Le résumé d'une ligne ne dit pas si l'artisan a chiffré, à quel
            -- prix, ni pourquoi le client a dit non. Sans ces éléments, on
            -- réattribue à l'aveugle — ou on n'ose pas réattribuer du tout.
            'recu_le', coalesce(af.created_at, p.created_at),
            'etape', af.etape,
            'date_rdv', af.date_rdv,
            'montant_devis_signe', af.montant_devis_signe,
            'devis_url', case when v_signe then af.devis_url end,
            'devis_signe_url', case when v_signe then af.devis_signe_url end,
            'devis_depose', af.devis_url is not null,
            'suivis', case when v_signe then (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            ) else '[]'::json end,
            'derniere_raison', case when v_signe then (
              select s.message from public.suivis s
               where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
               order by s.created_at desc limit 1
            ) else null end
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

  -- 0200 : AUCUN chantier avant la signature du contrat. Seul leur nombre
  -- est donné, pour inviter à signer. La liste, même sans identité client,
  -- livrait ville, description, budget et photos de la maison.
  if not v_signe then
    select count(*) into v_nb
      from public.affectations af
      join public.projets p on p.id = af.projet_id
     where af.artisan_id = a.id
       and p.deleted_at is null
       and af.retire_at is null
       and af.masque_at is null
       and p.statut <> 'mort'
       and not (af.statut = 'perdu' and coalesce(af.perdu_at, af.updated_at) < now() - interval '15 days');
    return (v_res::jsonb
      || jsonb_build_object('projets', '[]'::jsonb, 'projets_perdus', '[]'::jsonb,
                            'nb_chantiers_en_attente', v_nb))::json;
  end if;
  return (v_res::jsonb || jsonb_build_object('nb_chantiers_en_attente', 0))::json;
end;
$function$;

CREATE OR REPLACE FUNCTION public.metre_contexte_by_token(p_token text, p_affectation_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_artisan uuid;
  af public.affectations;
  p  public.projets;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  -- 0200 : la position de la maison (coordonnées, bâtiment retenu) et les
  -- échanges ne sortent qu'une fois le contrat signé, comme l'adresse.
  if p_affectation_token is not null
     and public.acces_suivi_par_jeton(p_affectation_token, true) = 'contrat_requis' then
    return json_build_object('ok', false, 'error', 'contrat_requis');
  end if;

  if p_affectation_token is not null then
    select * into af from public.affectations where token = p_affectation_token;
    if af.id is null or af.artisan_id <> v_artisan then
      return json_build_object('ok', false, 'error', 'chantier_introuvable');
    end if;
    select * into p from public.projets where id = af.projet_id;
  end if;

  return json_build_object(
    'ok', true,
    'projet_id', p.id,
    'affectation_id', af.id,
    'client_ville', p.client_ville,
    'client_adresse', case when p.id is not null
       and exists (select 1 from public.contrats c
                    where c.artisan_id = v_artisan and c.signed_at is not null)
      then p.client_adresse end,
    'client_code_postal', p.client_code_postal,
    'latitude', p.latitude,
    'longitude', p.longitude,
    'metier', p.metier,
    'metiers', p.metiers,
    -- La maison retenue pour ce chantier (0168) : la même pour l'agence et
    -- pour chaque artisan. L'adresse retrouvée suit la règle de l'adresse du
    -- client : visible seulement une fois le contrat signé.
    'batiment_cleabs', p.batiment_cleabs,
    'batiment_source', p.batiment_source,
    'batiment_confirme_at', p.batiment_confirme_at,
    'batiment_lon', p.batiment_lon,
    'batiment_lat', p.batiment_lat,
    'adresse_score', p.adresse_score,
    'adresse_retrouvee', case when p.id is not null
       and exists (select 1 from public.contrats c
                    where c.artisan_id = v_artisan and c.signed_at is not null)
      then p.adresse_retrouvee end,
    'metres', (
      select coalesce(json_agg(json_build_object(
               'id', m.id, 'nom', m.nom, 'type', m.type, 'geometrie', m.geometrie,
               'surface_m2', m.surface_m2, 'perimetre_m', m.perimetre_m,
               'longueur_m', m.longueur_m, 'hauteur_m', m.hauteur_m,
               'pente_pct', m.pente_pct, 'surface_reelle_m2', m.surface_reelle_m2,
               'ouvertures_m2', m.ouvertures_m2, 'azimut', m.azimut,
               'pente_source', m.pente_source, 'hauteur_source', m.hauteur_source,
               'source', m.source, 'created_at', m.created_at,
               'releve_id', m.releve_id,
               'modifiable_trace', coalesce(
                 m.affectation_id = af.id and public.acces_suivi_par_jeton(p_affectation_token) is null
                 and m.source = 'dessin' and m.type in ('surface', 'longueur')
                 and m.releve_id is null and m.pente_pct is null and m.hauteur_m is null
                 and (m.surface_reelle_m2 is null or m.surface_reelle_m2 = m.surface_m2), false))
             order by m.created_at desc), '[]'::json)
        from public.metres m where m.projet_id = p.id and m.artisan_id = v_artisan)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.contexte_devis_by_token(p_token text, p_affectation_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_artisan uuid;
  af public.affectations;
  p public.projets;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  -- 0200 : la position de la maison (coordonnées, bâtiment retenu) et les
  -- échanges ne sortent qu'une fois le contrat signé, comme l'adresse.
  if p_affectation_token is not null
     and public.acces_suivi_par_jeton(p_affectation_token, true) = 'contrat_requis' then
    return json_build_object('ok', false, 'error', 'contrat_requis');
  end if;

  -- L'affectation doit appartenir à CET artisan : sans ce contrôle, un jeton
  -- de chantier glané ailleurs donnerait accès au dossier d'un concurrent.
  select * into af from public.affectations
   where token = p_affectation_token and artisan_id = v_artisan;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;

  select * into p from public.projets where id = af.projet_id;

  return json_build_object(
    'ok', true,
    'metier', p.metier,
    'metiers', p.metiers,
    'sous_metier', p.sous_metier,
    'description', p.description,
    'budget_estime', p.budget_estime,
    'ville', p.client_ville,
    'code_postal', p.client_code_postal,
    -- Les échanges, du plus ancien au plus récent : c'est la chronologie qui
    -- donne le sens (« finalement il ne veut plus le portail »).
    'echanges', coalesce((
      select json_agg(json_build_object(
        'auteur', s.auteur, 'message', s.message, 'statut', s.statut_artisan,
        'le', s.created_at) order by s.created_at)
      from public.suivis s
      where s.affectation_id = af.id
        and coalesce(btrim(s.message), '') <> ''
    ), '[]'::json)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.documents_projet_par_token(p_token text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    json_agg(
      json_build_object(
        'id', d.id,
        'nom', d.nom,
        'type_mime', d.type_mime,
        'taille_octets', d.taille_octets,
        'created_at', d.created_at
      ) order by d.created_at desc
    ),
    '[]'::json
  )
  from public.affectations af
  join public.projets p         on p.id = af.projet_id
  join public.projet_documents d on d.projet_id = p.id
  where af.token = p_token
    and af.retire_at is null
    and not exists (select 1 from public.artisans x where x.id = af.artisan_id and x.ecarte_at is not null)
    and p.deleted_at is null
    and d.visible_artisan
    -- 0200 : pas de documents avant la signature du contrat.
    and public.acces_suivi_par_jeton(af.token, true) is distinct from 'contrat_requis';
$function$;
