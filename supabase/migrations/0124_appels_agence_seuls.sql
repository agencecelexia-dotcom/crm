-- Les pastilles comptent NOS appels, pas ceux de l'artisan.
--
-- L'ERREUR
--
-- La migration 0123 comptait toutes les tentatives, sans distinguer leur
-- auteur. Or les 499 appels enregistrés viennent tous de l'espace artisan :
-- ce sont les artisans qui appelaient leurs clients, avant d'abandonner.
--
-- Le compteur affichait donc l'acharnement de quelqu'un d'autre. Un chantier
-- que l'agence n'a jamais appelé pouvait montrer cinq pastilles rouges et se
-- voir proposer à la suppression.
--
-- LA RÈGLE
--
-- Seuls les appels de l'AGENCE comptent, et seulement ceux passés depuis que
-- le chantier est revenu dans la pile. Quand un artisan rend un dossier, le
-- compteur repart de zéro : c'est une nouvelle tentative de placement, et
-- l'historique de l'artisan précédent ne nous dit rien de la nôtre.

CREATE OR REPLACE FUNCTION public.chantiers_a_reattribuer()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(json_agg(x order by x.sorti_le desc), '[]'::json)
  from (
    select
      p.id                         as projet_id,
      af.id                        as affectation_id,
      p.client_nom,
      p.client_telephone,
      p.client_ville,
      p.client_code_postal,
      p.metier,
      p.metiers,
      p.description,
      p.statut                     as statut_projet,
      coalesce(a.societe, a.nom)   as artisan_nom,
      af.artisan_id,
      af.etape,
      af.montant_devis,
      af.devis_url is not null     as devis_depose,
      af.motif_perte,
      af.motif_perte_detail,
      coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
      case
        when af.retire_at is not null then 'retrait'
        when af.statut = 'perdu'      then 'perdu'
        else 'masque'
      end as nature,
      (select s.message from public.suivis s
        where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
        order by s.created_at desc limit 1) as derniere_raison,
      -- Toujours 0 par construction (origine = 'reprise'), mais conservé : le
      -- front l'affiche et d'autres appelants peuvent en dépendre.
      0::bigint as artisans_actifs,
      p.assigne_a,
      (select m.nom from public.membres m where m.user_id = p.assigne_a) as assigne_nom,
      (current_date - coalesce(af.retire_at, af.perdu_at, af.updated_at)::date) as jours_dattente,

      -- Historique des tentatives d'appel, dans l'ordre. Le front en fait cinq
      -- pastilles : rouge quand personne n'a décroché, verte quand le client a
      -- répondu. Cinq échecs d'affilée disent qu'il faut cesser d'insister.
      coalesce((
        select json_agg(s.resultat_appel order by s.created_at)
          from public.suivis s
         where s.projet_id = p.id
           and s.type = 'appel'
           and s.auteur = 'agence'
           and s.resultat_appel is not null
           and s.created_at >= coalesce(af.retire_at, af.perdu_at, af.updated_at)
      ), '[]'::json) as appels,
      (select count(*) from public.suivis s
        where s.projet_id = p.id and s.type = 'appel' and s.auteur = 'agence'
          and s.created_at >= coalesce(af.retire_at, af.perdu_at, af.updated_at)
      ) as nb_appels,
      (select count(*) from public.suivis s
        where s.projet_id = p.id and s.type = 'appel' and s.auteur = 'agence'
          and s.resultat_appel = 'pas_de_reponse'
          and s.created_at >= coalesce(af.retire_at, af.perdu_at, af.updated_at)
      ) as nb_sans_reponse,
      (select max(s.created_at) from public.suivis s
        where s.projet_id = p.id and s.type = 'appel' and s.auteur = 'agence'
          and s.created_at >= coalesce(af.retire_at, af.perdu_at, af.updated_at)
      ) as dernier_appel
    from public.affectations af
    join public.projets p on p.id = af.projet_id
    left join public.artisans a on a.id = af.artisan_id
    where p.deleted_at is null
      -- Le filtre tient maintenant en une condition : plus personne dessus.
      and p.origine = 'reprise'
      and p.statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
      and (af.retire_at is not null or af.masque_at is not null or af.statut = 'perdu')
      -- Une seule ligne par projet : la sortie la plus récente. Sans cela, un
      -- chantier passé par trois artisans apparaissait trois fois.
      and af.id = (
        select af2.id from public.affectations af2
         where af2.projet_id = p.id
           and (af2.retire_at is not null or af2.masque_at is not null
                or af2.statut = 'perdu')
         order by coalesce(af2.retire_at, af2.perdu_at, af2.updated_at) desc
         limit 1
      )
  ) x;
$function$;
