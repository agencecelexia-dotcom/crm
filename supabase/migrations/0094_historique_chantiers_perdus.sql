-- Historique complet sur les chantiers sortis du pipe.
--
-- L'espace « perdus » ne renvoyait qu'un résumé : ville, métier, motif et une
-- seule ligne de commentaire. Impossible d'y voir ce qui s'était réellement
-- passé — l'artisan a-t-il chiffré ? à quel montant ? le client a-t-il refusé
-- le prix ou disparu ? Or c'est exactement ce qu'il faut savoir pour décider
-- si un chantier vaut d'être réattribué, et à qui.
--
-- On renvoie donc le même niveau de détail que pour un chantier actif : le fil
-- de discussion complet, les devis déposés, l'étape atteinte, le montant.
-- Le téléphone reste soumis à la signature du contrat, comme partout ailleurs.

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
            'recu_le', p.created_at,
            'derniere_activite', af.updated_at,
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
            'devis_url', af.devis_url,
            'devis_signe_url', af.devis_signe_url,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'non_lus', (select count(*) from public.suivis s2
                        where s2.affectation_id = af.id
                          and s2.auteur = 'agence' and s2.lu_at is null),
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                -- Le fil devient bidirectionnel : l'artisan distingue enfin
                -- une consigne de l'agence de sa propre saisie (0080).
                'lu_at', s.lu_at, 'id', s.id
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
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_code_postal', p.client_code_postal,
            'motif_perte', af.motif_perte,
            -- Ce qui manquait pour décider d'une réattribution : l'HISTORIQUE.
            -- Le résumé d'une ligne ne dit pas si l'artisan a chiffré, à quel
            -- prix, ni pourquoi le client a dit non. Sans ces éléments, on
            -- réattribue à l'aveugle — ou on n'ose pas réattribuer du tout.
            'recu_le', coalesce(af.created_at, p.created_at),
            'etape', af.etape,
            'date_rdv', af.date_rdv,
            'montant_devis_signe', af.montant_devis_signe,
            'devis_url', af.devis_url,
            'devis_signe_url', af.devis_signe_url,
            'devis_depose', af.devis_url is not null,
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at,
                'lu_at', s.lu_at, 'id', s.id
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            ),
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
$function$

