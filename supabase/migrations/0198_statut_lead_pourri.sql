-- Statut « lead_pourri » (« Lead de 💩 ») : un faux lead, hors pipeline.
--
-- Demande d'information sans projet réel, mauvais numéro, plaisantin, client
-- hors cible… Ce n'est ni un démarcheur (« demarchage »), ni un lead perdu
-- (« mort ») : il n'a jamais été un lead. Le compter comme « mort » dégraderait
-- le taux de conversion ; le laisser en « nouveau » polluerait le pipe.
--
-- Il suit donc exactement « demarchage » : exclu de tous les compteurs, de
-- toutes les files d'action et verrouillé contre la synchronisation des
-- affectations. Chaque fonction ci-dessous est reprise telle quelle depuis sa
-- dernière définition ; seul l'ajout de 'lead_pourri' à côté de
-- 'demarchage' change.

alter table public.projets drop constraint if exists projets_statut_check;

alter table public.projets add constraint projets_statut_check
  check (statut = any (array[
    'nouveau', 'a_reattribuer', 'a_rappeler', 'en_attente', 'artisan_assigne',
    'contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine',
    'perdu', 'mort', 'artisan_demarche', 'demarchage', 'lead_pourri'
  ]));

comment on column public.projets.statut is
  'Étape du pipeline. « mort » = lead client sans suite. « artisan_demarche » = artisan cherchant du travail, à ne pas rappeler comme prospect mais utile au recrutement. « demarchage » = sollicitation commerciale (agence web, assurance, énergie), sans valeur future. « lead_pourri » = faux lead (pas de projet réel), hors pipeline et hors statistiques.';

-- ---------- a_traiter ----------

CREATE OR REPLACE FUNCTION public.a_traiter()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select json_build_object(
    -- 1. Des leads jamais partis chez un artisan. Chaque jour d'attente est
    --    un client qui appelle un concurrent.
    'leads_neufs', (
      select count(*) from public.projets
       where deleted_at is null and masque_agence_at is null
         and origine = 'neuf'
         and statut not in ('mort', 'devis_signe', 'termine',
                            'artisan_demarche', 'demarchage', 'lead_pourri')
    ),
    'leads_neufs_vieux', (
      select count(*) from public.projets
       where deleted_at is null and masque_agence_at is null
         and origine = 'neuf'
         and statut not in ('mort', 'devis_signe', 'termine',
                            'artisan_demarche', 'demarchage', 'lead_pourri')
         and created_at < now() - interval '3 days'
    ),

    -- 2. Signé mais pas encore encaissé : c'est de l'argent dû à l'agence.
    -- Même définition partout (commissions_dues, 0166) : une affaire réellement
    -- gagnée par un artisan. Le statut « devis_signe » seul oubliait les
    -- chantiers terminés.
    'a_encaisser_n', (select count(*) from public.commissions_dues()),
    'a_encaisser_montant', coalesce((select sum(commission) from public.commissions_dues()), 0),

    -- 3. Plus aucun artisan dessus : à replacer. C'est la zone de commission
    --    du commercial.
    'a_reprendre', (
      select count(*) from public.projets
       where deleted_at is null and masque_agence_at is null
         and origine = 'reprise'
         and statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
         and assigne_a is null
    ),
    'repris_en_cours', (
      select count(*) from public.projets
       where deleted_at is null and masque_agence_at is null
         and assigne_a is not null
         and statut not in ('mort', 'devis_signe', 'termine')
    ),

    -- 4. Ce qui est dû aux commerciaux, une fois la commission encaissée.
    'a_verser', coalesce((
      select sum(montant) from public.retrocessions where verse_at is null
    ), 0),

    -- 5. Santé du pipe artisan : ce qui vit, et ce qui dort.
    'chez_artisan', (
      select count(*) from public.projets
       where deleted_at is null and masque_agence_at is null
         and origine = 'chez_artisan'
         and statut not in ('mort', 'devis_signe', 'termine')
    ),
    'chez_artisan_dormants', (
      select count(*) from public.projets p
       where p.deleted_at is null and p.masque_agence_at is null
         and p.origine = 'chez_artisan'
         and p.statut not in ('mort', 'devis_signe', 'termine')
         and p.updated_at < now() - interval '21 days'
    ),

    -- 6. Des métrés où la parole du client et la mesure divergent (0171) :
    --    à trancher avant que l'artisan ne chiffre. Seulement les chantiers
    --    que le membre voit, comme la table elle-même.
    'metrages_a_verifier', (
      select count(distinct m.projet_id) from public.metrage_chantier m
        join public.projets p on p.id = m.projet_id
       where m.statut in ('ecart', 'sources_desaccord')
         and p.deleted_at is null and p.masque_agence_at is null
         and m.projet_id in (select public.mes_projets())
    )
  );
$function$;


-- ---------- ca_signe_par_mois ----------

CREATE OR REPLACE FUNCTION public.ca_signe_par_mois(p_mois integer DEFAULT 6)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with gagnees as (
    select a.id, a.projet_id,
           coalesce(a.montant_devis_signe, a.montant_devis, 0) as montant,
           p.commission,
           coalesce(
             (select min(s.created_at) from public.suivis s
               where s.affectation_id = a.id and s.statut_artisan = 'devis_signe'),
             p.date_signature::timestamptz,
             a.updated_at
           ) as signe_le
      from public.affectations a
      join public.projets p on p.id = a.projet_id
     where a.issue = 'gagne'
       and p.deleted_at is null
       and p.statut not in ('artisan_demarche', 'demarchage', 'lead_pourri')
  ),
  mois as (
    select generate_series(
             date_trunc('month', now() at time zone 'Europe/Paris') - make_interval(months => greatest(p_mois, 1) - 1),
             date_trunc('month', now() at time zone 'Europe/Paris'),
             interval '1 month') as debut
  )
  select coalesce(json_agg(json_build_object(
           'mois', to_char(m.debut, 'YYYY-MM'),
           'ca', coalesce((select sum(g.montant) from gagnees g
                            where date_trunc('month', g.signe_le at time zone 'Europe/Paris') = m.debut), 0),
           'commission', coalesce((select sum(x.commission) from (
                            select distinct on (g.projet_id) g.projet_id, g.commission
                              from gagnees g
                             where date_trunc('month', g.signe_le at time zone 'Europe/Paris') = m.debut) x), 0)
         ) order by m.debut), '[]'::json)
    from mois m;
$function$;


-- ---------- commissions_dues ----------

CREATE OR REPLACE FUNCTION public.commissions_dues()
 RETURNS TABLE(projet_id uuid, commission numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id, p.commission
    from public.projets p
   where p.deleted_at is null
     and not coalesce(p.commission_encaissee, false)
     and coalesce(p.commission, 0) > 0
     and p.statut not in ('artisan_demarche', 'demarchage', 'lead_pourri')
     and exists (select 1 from public.affectations a
                  where a.projet_id = p.id and a.issue = 'gagne')
     -- Mêmes règles de visibilité que les projets : chacun voit les siens.
     and (coalesce(auth.role(), '') <> 'authenticated'
          or p.id in (select public.mes_projets()));
$function$;


-- ---------- kpi_agence ----------

CREATE OR REPLACE FUNCTION public.kpi_agence(p_debut date DEFAULT NULL::date, p_fin date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with
  -- Périmètre : les affectations non retirées de la période. Les retraits
  -- restent comptés dans `leads_transmis` (un lead rendu a bien été envoyé)
  -- mais sortent des taux de conversion.
  af as (
    select a.*, p.client_ville, p.metier, p.created_by, p.assigne_a,
           p.commission, p.commission_encaissee, p.taux_commission,
           p.montant_devis_signe as montant_projet
    from public.affectations a
    join public.projets p on p.id = a.projet_id
    where p.deleted_at is null
      and p.statut not in ('artisan_demarche', 'demarchage', 'lead_pourri')
      and (p_debut is null or a.created_at::date >= p_debut)
      and (p_fin   is null or a.created_at::date <= p_fin)
  ),
  actives as (select * from af where retire_at is null),

  -- Jalons horodatés, reconstitués depuis les suivis.
  -- `date_signature` n'est renseignée que sur 3 dossiers sur 15 ; les suivis
  -- en couvrent 12. C'est donc eux qui font foi pour mesurer les délais.
  jalons as (
    select s.affectation_id,
           min(s.created_at) filter (where s.statut_artisan = 'contacte')     as t_contact,
           min(s.created_at) filter (where s.statut_artisan = 'rdv_pris')     as t_rdv,
           min(s.created_at) filter (where s.statut_artisan = 'devis_envoye') as t_devis,
           min(s.created_at) filter (where s.statut_artisan = 'devis_signe')  as t_signe
    from public.suivis s
    group by 1
  ),
  delais as (
    select
      -- Seuil de 60 s : en deçà, deux clics de la même session de saisie ne
      -- mesurent aucune durée réelle.
      case when extract(epoch from (j.t_contact - a.created_at)) >= 60
           then extract(epoch from (j.t_contact - a.created_at)) / 86400 end as d_contact,
      case when extract(epoch from (j.t_signe - a.created_at)) >= 60
           then extract(epoch from (j.t_signe - a.created_at)) / 86400 end as d_signature,
      case when extract(epoch from (j.t_signe - j.t_devis)) >= 60
           then extract(epoch from (j.t_signe - j.t_devis)) / 86400 end as d_devis_signe
    from af a join jalons j on j.affectation_id = a.id
    where a.issue = 'gagne'
  )

  select json_build_object(
    -- ---------- Volume ----------
    'leads_transmis',        (select count(*) from af),
    'leads_actifs',          (select count(*) from actives where issue = 'en_cours'),
    'leads_rendus',          (select count(*) from af where retire_at is not null),
    'artisans_sollicites',   (select count(distinct artisan_id) from af),

    -- ---------- Parcours ----------
    'jamais_ouverts',        (select count(*) from actives
                               where etape is null and issue = 'en_cours'),
    'contactes',             (select count(*) from af where rang_etape(etape) >= 1),
    'rdv_pris',              (select count(*) from af where rang_etape(etape) >= 2),
    'devis_envoyes',         (select count(*) from af where rang_etape(etape) >= 3),
    'signes',                (select count(*) from af where issue = 'gagne'),
    'perdus',                (select count(*) from af where issue = 'perdu'),

    -- ---------- Taux, dénominateur nommé ----------
    -- « sur_transmis » : sur TOUT ce qui est parti chez un artisan.
    -- « sur_devis »    : seulement sur les dossiers arrivés au chiffrage.
    -- Les deux sont utiles ; les confondre était l'erreur.
    'taux_ouverture_sur_transmis', (select case when count(*) > 0 then
       round(100.0 * count(*) filter (where rang_etape(etape) >= 1) / count(*)) end from af),
    'taux_devis_sur_transmis',     (select case when count(*) > 0 then
       round(100.0 * count(*) filter (where rang_etape(etape) >= 3) / count(*)) end from af),
    'taux_signature_sur_devis',    (select case
       when count(*) filter (where rang_etape(etape) >= 3 and issue <> 'en_cours') > 0
       then round(100.0 * count(*) filter (where issue = 'gagne')
            / count(*) filter (where rang_etape(etape) >= 3 and issue <> 'en_cours')) end from af),
    'taux_conversion_global',      (select case
       when count(*) filter (where issue <> 'en_cours' or retire_at is not null) > 0
       then round(100.0 * count(*) filter (where issue = 'gagne')
            / count(*) filter (where issue <> 'en_cours' or retire_at is not null)) end from af),

    -- ---------- Délais, en jours ----------
    -- La médiane plutôt que la moyenne : un dossier signé à 34 jours ne doit
    -- pas déplacer l'indicateur de toute une équipe.
    'delai_ouverture_j',     (select round(percentile_cont(0.5)
                               within group (order by d_contact)::numeric, 1) from delais),
    'delai_signature_j',     (select round(percentile_cont(0.5)
                               within group (order by d_signature)::numeric, 1) from delais),
    'delai_devis_signe_j',   (select round(percentile_cont(0.5)
                               within group (order by d_devis_signe)::numeric, 1) from delais),
    'delai_signature_n',     (select count(d_signature) from delais),

    -- ---------- Argent ----------
    -- Tout part de l'affectation gagnée : c'est le seul niveau qui sait QUI a
    -- signé. Un montant posé sur un projet orphelin n'entre pas ici.
    'ca_signe',              (select coalesce(sum(coalesce(montant_devis_signe, montant_devis)), 0)
                               from af where issue = 'gagne'),
    'panier_moyen',          (select round(avg(coalesce(montant_devis_signe, montant_devis)))
                               from af where issue = 'gagne'
                                 and coalesce(montant_devis_signe, montant_devis) > 0),
    'panier_median',         (select round(percentile_cont(0.5) within group (
                                 order by coalesce(montant_devis_signe, montant_devis))::numeric)
                               from af where issue = 'gagne'
                                 and coalesce(montant_devis_signe, montant_devis) > 0),
    'devis_moyen_envoye',    (select round(avg(montant_devis)) from af
                               where rang_etape(etape) >= 3 and montant_devis > 0),
    'devis_median_envoye',   (select round(percentile_cont(0.5)
                               within group (order by montant_devis)::numeric)
                               from af where rang_etape(etape) >= 3 and montant_devis > 0),
    'pipe_chiffre',          (select coalesce(sum(montant_devis), 0) from actives
                               where issue = 'en_cours' and montant_devis > 0),
    'montant_perdu',         (select coalesce(sum(montant_devis), 0) from af
                               where issue = 'perdu' and montant_devis > 0),

    -- ---------- Commission ----------
    -- Calculée sur les projets gagnés uniquement, pour la même raison.
    'commission_acquise',    (select coalesce(sum(distinct_p.commission), 0)
                               from (select distinct on (a.projet_id) a.projet_id, a.commission
                                     from af a where a.issue = 'gagne') distinct_p),
    'commission_encaissee',  (select coalesce(sum(distinct_p.commission), 0)
                               from (select distinct on (a.projet_id) a.projet_id, a.commission,
                                            a.commission_encaissee
                                     from af a where a.issue = 'gagne') distinct_p
                               where distinct_p.commission_encaissee),
    'commission_a_encaisser',(select coalesce(sum(distinct_p.commission), 0)
                               from (select distinct on (a.projet_id) a.projet_id, a.commission,
                                            a.commission_encaissee
                                     from af a where a.issue = 'gagne') distinct_p
                               where not coalesce(distinct_p.commission_encaissee, false)),
    'taux_commission_moyen', (select round(avg(taux_commission) * 100, 1)
                               from af where issue = 'gagne'),

    'periode_debut', p_debut,
    'periode_fin',   p_fin
  );
$function$;


-- ---------- kpi_par_artisan ----------

CREATE OR REPLACE FUNCTION public.kpi_par_artisan(p_debut date DEFAULT NULL::date, p_fin date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with af as (
    select a.*, coalesce(ar.societe, ar.nom) as artisan_nom, ar.id as art_id,
           p.commission, p.commission_encaissee
    from public.affectations a
    join public.projets p on p.id = a.projet_id
    left join public.artisans ar on ar.id = a.artisan_id
    where p.deleted_at is null
      and p.statut not in ('artisan_demarche', 'demarchage', 'lead_pourri')
      and (p_debut is null or a.created_at::date >= p_debut)
      and (p_fin   is null or a.created_at::date <= p_fin)
  ),
  jalons as (
    select s.affectation_id,
           min(s.created_at) filter (where s.statut_artisan = 'devis_signe') as t_signe
    from public.suivis s group by 1
  )
  select coalesce(json_agg(x order by x.ca_signe desc nulls last), '[]'::json)
  from (
    select
      af.art_id as artisan_id,
      af.artisan_nom,
      count(*) as leads_transmis,
      count(*) filter (where af.retire_at is not null) as rendus,
      count(*) filter (where af.etape is null and af.issue = 'en_cours'
                         and af.retire_at is null) as jamais_ouverts,
      count(*) filter (where rang_etape(af.etape) >= 3) as devis_envoyes,
      count(*) filter (where af.issue = 'gagne') as signes,
      count(*) filter (where af.issue = 'perdu') as perdus,

      case when count(*) filter (where af.issue <> 'en_cours' or af.retire_at is not null) > 0
        then round(100.0 * count(*) filter (where af.issue = 'gagne')
             / count(*) filter (where af.issue <> 'en_cours' or af.retire_at is not null))
      end as taux_conversion_global,

      coalesce(sum(coalesce(af.montant_devis_signe, af.montant_devis))
               filter (where af.issue = 'gagne'), 0) as ca_signe,
      round(avg(coalesce(af.montant_devis_signe, af.montant_devis))
            filter (where af.issue = 'gagne'
                      and coalesce(af.montant_devis_signe, af.montant_devis) > 0)) as panier_moyen,

      -- Réactivité : combien de jours entre l'envoi du chantier et la signature.
      round(percentile_cont(0.5) within group (
        order by case when extract(epoch from (j.t_signe - af.created_at)) >= 60
                      then extract(epoch from (j.t_signe - af.created_at)) / 86400 end
      )::numeric, 1) as delai_signature_j
    from af
    left join jalons j on j.affectation_id = af.id
    where af.art_id is not null
    group by af.art_id, af.artisan_nom
  ) x;
$function$;


-- ---------- mes_stats_commercial ----------

CREATE OR REPLACE FUNCTION public.mes_stats_commercial()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                                'artisan_demarche','demarchage', 'lead_pourri')),
    'a_attribuer',       (select count(*) from p
                           where not exists (select 1 from public.affectations a
                                              where a.projet_id = p.id and a.retire_at is null)
                             and statut not in ('perdu','mort','artisan_demarche','demarchage', 'lead_pourri')),

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
                                                   'artisan_demarche','demarchage', 'lead_pourri')
                             and exists (select 1 from public.affectations a
                                          where a.projet_id = pr.id and a.retire_at is not null)
                             and not exists (select 1 from public.affectations a
                                              where a.projet_id = pr.id and a.retire_at is null
                                                and a.issue = 'en_cours'))
  );
$function$;


-- ---------- projets_a_premesurer ----------

CREATE OR REPLACE FUNCTION public.projets_a_premesurer(p_limite integer DEFAULT 6)
 RETURNS TABLE(id uuid, metier text, metiers text[], client_adresse text, client_code_postal text, client_ville text, latitude numeric, longitude numeric, batiment_cleabs text, batiment_source text, batiment_confirme_at timestamp with time zone, batiment_lon numeric, batiment_lat numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id, p.metier, p.metiers,
         p.client_adresse, p.client_code_postal, p.client_ville,
         p.latitude::numeric, p.longitude::numeric,
         p.batiment_cleabs, p.batiment_source, p.batiment_confirme_at,
         p.batiment_lon, p.batiment_lat
    from public.projets p
   where p.deleted_at is null
     and p.statut not in ('mort', 'termine', 'perdu', 'artisan_demarche', 'demarchage', 'lead_pourri')
     and p.client_adresse ~ '^\s*\d'
     -- Les métiers dont l'outil sait mesurer une quantité (toit, murs, terrain).
     and (p.metier = any (array['Couverture', 'Toiture', 'Solaire / Photovoltaïque', 'Façade / Ravalement',
                                'Isolation', 'Peinture', 'Maçonnerie', 'Clôture', 'Paysagisme', 'Piscine'])
          or coalesce(p.metiers, '{}') && array['Couverture', 'Toiture', 'Solaire / Photovoltaïque',
                                'Façade / Ravalement', 'Isolation', 'Peinture', 'Maçonnerie', 'Clôture',
                                'Paysagisme', 'Piscine'])
     and exists (select 1 from public.affectations a where a.projet_id = p.id and a.retire_at is null)
     and not exists (select 1 from public.metrage_chantier m where m.projet_id = p.id and m.valeur_mesuree is not null)
     and (p.metrage_tente_le is null or p.metrage_tente_le < now() - interval '1 day')
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limite, 6), 20));
$function$;


-- ---------- rang_statut ----------

CREATE OR REPLACE FUNCTION public.rang_statut(p_statut text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_statut
    when 'demarchage'        then 0
    when 'lead_pourri'        then 0
    when 'artisan_demarche'  then 0
    when 'nouveau'           then 1
    when 'a_reattribuer'     then 1
    when 'a_rappeler'        then 2
    when 'artisan_assigne'   then 3
    when 'contacte'          then 4
    when 'rdv_pris'          then 5
    when 'devis_envoye'      then 6
    when 'devis_signe'       then 7
    when 'termine'           then 8
    when 'perdu'             then 9
    when 'mort'              then 9
    else 0
  end;
$function$;


-- ---------- stats_agence ----------

CREATE OR REPLACE FUNCTION public.stats_agence()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with p as (
    -- « artisan_demarche » n'est pas un projet : c'est un artisan qui a
    -- démarché l'agence. L'exclure ICI plutôt que dans chaque compteur évite
    -- d'en oublier un — il gonflait projets_total, projets_actifs et
    -- non_attribues, ce dernier le présentant comme un lead à attribuer.
    select * from public.projets
     where deleted_at is null
       and statut not in ('artisan_demarche', 'demarchage', 'lead_pourri')
  ),
  af as (
    select a.* from public.affectations a
    join public.projets pr on pr.id = a.projet_id
    where pr.deleted_at is null
      and pr.statut not in ('artisan_demarche', 'demarchage', 'lead_pourri')
  )
  select json_build_object(
    -- ---------- Volume ----------
    'projets_total',        (select count(*) from p),
    'projets_actifs',       (select count(*) from p
                              where statut not in ('perdu', 'mort', 'termine')),
    'en_attente',           (select count(*) from p where statut = 'en_attente'),
    'a_rappeler',           (select count(*) from p where statut = 'a_rappeler'),
    'non_attribues',        (select count(*) from p
                              where artisan_id is null
                                and statut not in ('perdu', 'mort', 'termine')),

    -- ---------- Devis (au niveau affectation : un par artisan) ----------
    'devis_deposes',        (select count(*) from af where montant_devis is not null),
    'devis_montant_total',  (select coalesce(sum(montant_devis), 0) from af
                              where montant_devis is not null),
    'devis_montant_median', (select coalesce(
                               percentile_cont(0.5) within group (order by montant_devis), 0)
                             from af where montant_devis is not null and montant_devis > 0),
    'devis_signes',         (select count(*) from af
                              where statut in ('devis_signe', 'termine')),

    -- ---------- Pertes ----------
    'perdus',               (select count(*) from p where statut = 'perdu'),
    'morts',                (select count(*) from p where statut = 'mort'),
    'termines',             (select count(*) from p where statut = 'termine'),

    -- ---------- Conversion ----------
    -- Dénominateur : les dossiers TRANCHÉS (gagnés + définitivement perdus).
    -- Inclure les dossiers en cours écraserait artificiellement le taux.
    'conversion_tranches',  (select count(*) from p
                              where statut in ('devis_signe', 'termine', 'perdu', 'mort')),
    'conversion_gagnes',    (select count(*) from p
                              where statut in ('devis_signe', 'termine')),

    -- ---------- Argent ----------
    'ca_signe',             (select coalesce(sum(montant_devis_signe), 0) from p
                              where statut in ('devis_signe', 'termine')),
    'commission_acquise',   (select coalesce(sum(commission), 0) from p
                              where statut in ('devis_signe', 'termine')),
    'commission_encaissee', (select coalesce(sum(commission), 0) from p
                              where commission_encaissee),
    'commission_a_encaisser', (select coalesce(sum(commission), 0) from p
                              where statut in ('devis_signe', 'termine')
                                and not commission_encaissee),
    -- Espérance sur les devis envoyés non encore signés, au taux du projet.
    'commission_potentielle', (select coalesce(sum(a.montant_devis * coalesce(pr.taux_commission, 0.10)), 0)
                               from af a
                               join p pr on pr.id = a.projet_id
                               where a.statut = 'devis_envoye' and a.montant_devis is not null),

    -- ---------- Artisans ----------
    'artisans_total',       (select count(*) from public.artisans),
    'artisans_actifs',      (select count(distinct artisan_id) from af)
  );
$function$;


-- ---------- statut_projet_verrouille ----------

CREATE OR REPLACE FUNCTION public.statut_projet_verrouille(p_statut text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_statut in ('perdu', 'mort', 'artisan_demarche', 'demarchage', 'lead_pourri');
$function$;


-- ---------- trg_origine_chantier ----------

CREATE OR REPLACE FUNCTION public.trg_origine_chantier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_projet uuid;
  v_origine text;
  v_statut text;
begin
  v_projet := coalesce(new.projet_id, old.projet_id);
  v_origine := public.calculer_origine(v_projet);

  select statut into v_statut from public.projets where id = v_projet;

  update public.projets
     set origine = v_origine,
         statut = case
           -- Sortie du dernier artisan : le chantier devient à replacer.
           when v_origine = 'reprise'
            and v_statut not in ('devis_signe', 'termine', 'mort',
                                 'artisan_demarche', 'demarchage', 'lead_pourri')
             then 'a_reattribuer'
           -- Un artisan le reprend : il repart dans le pipe normal.
           when v_origine = 'chez_artisan' and v_statut = 'a_reattribuer'
             then 'artisan_assigne'
           else v_statut
         end
   where id = v_projet;

  return coalesce(new, old);
end
$function$;
