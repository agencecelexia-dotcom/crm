-- Masquage agence : aucune suppression, aucun changement de statut artisan,
-- d'affectation ou de commission. La restauration remet le même dossier en vue.
alter table public.projets add column if not exists masque_agence_at timestamptz;
create index if not exists projets_visibles_agence_idx on public.projets(created_at desc)
  where deleted_at is null and masque_agence_at is null;

-- Masquer n'est pas une avancée commerciale : ne pas rajeunir artificiellement
-- les dossiers, notamment dans le suivi des reprises.
create function public.set_projet_updated_at() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['masque_agence_at','updated_at','commission'])
     = (to_jsonb(old) - array['masque_agence_at','updated_at','commission']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_projets_updated_at on public.projets;
create trigger trg_projets_updated_at before update on public.projets
  for each row execute function public.set_projet_updated_at();

create or replace function public.masquer_projet(p_projet_id uuid, p_masque boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.projets p where p.id = p_projet_id
      and p.id in (select public.mes_projets())
      and (public.est_fondateur() or p.created_by = auth.uid() or p.assigne_a = auth.uid())
  ) then
    raise exception 'Projet inaccessible' using errcode = '42501';
  end if;
  if p_masque is null then raise exception 'Visibilité requise'; end if;
  update public.projets
    set masque_agence_at = case when p_masque then coalesce(masque_agence_at, now()) else null end
    where id = p_projet_id and deleted_at is null;
  if not found then raise exception 'Projet introuvable'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.masquer_projet(uuid, boolean) from public, anon;
grant execute on function public.masquer_projet(uuid, boolean) to authenticated;

-- Les files d'action ignorent les projets masqués. Les commissions et le
-- suivi des reprises conservent leur périmètre et leur historique.
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
    where p.deleted_at is null and p.masque_agence_at is null
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
$function$
;

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
                            'artisan_demarche', 'demarchage')
    ),
    'leads_neufs_vieux', (
      select count(*) from public.projets
       where deleted_at is null and masque_agence_at is null
         and origine = 'neuf'
         and statut not in ('mort', 'devis_signe', 'termine',
                            'artisan_demarche', 'demarchage')
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
$function$
;

CREATE OR REPLACE FUNCTION public.action_du_jour()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    -- Leads nouveaux sans artisan
    'leads', (
      select count(*) from public.projets p
      where p.statut = 'nouveau' and p.deleted_at is null and p.masque_agence_at is null
        and not exists (select 1 from public.affectations a where a.projet_id = p.id)
    ),
    -- Artisans assignés dont le contrat n'est ni signé ni externe
    'contrats', (
      select count(*) from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut not in ('perdu','termine','devis_signe')
        and p.deleted_at is null and p.masque_agence_at is null and ar.contrat_externe = false
        and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
    ),
    -- RDV passés sans suivi depuis (l'artisan n'a rien noté après le RDV)
    'rdv', (
      select count(*) from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.statut = 'rdv_pris' and af.date_rdv is not null and af.date_rdv < now()
        and p.deleted_at is null and p.masque_agence_at is null
        and not exists (select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv)
    ),
    -- Devis envoyés qui traînent (+48 h sans évolution)
    'devis', (
      select count(*) from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.statut = 'devis_envoye' and p.deleted_at is null and p.masque_agence_at is null
        and af.updated_at < now() - interval '48 hours'
    ),
    -- Commissions signées non encaissées (nombre + total dû)
    -- Un montant posé sur un projet ne suffit plus : il faut une affaire
    -- réellement gagnée (commissions_dues, 0166). Un dossier « en attente »
    -- saisi à 60 000 € y comptait pour 6 000 € de commission due.
    'commissions_n', (select count(*) from public.commissions_dues()),
    'commissions_total', (select coalesce(sum(commission), 0) from public.commissions_dues())
  )
$function$
;

