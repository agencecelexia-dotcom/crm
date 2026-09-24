-- Une seule définition de « commission due ».
--
-- Trois blocs, trois chiffres (audit du pilotage) :
--   - « À traiter » : projets au statut `devis_signe` — oubliait les chantiers
--     `termine` (6 025 €) ;
--   - « Action du jour » et la page Commissions : tout projet portant un
--     montant signé non encaissé — comptait un dossier « en attente » saisi à
--     60 000 €, sans aucune signature, et proposait d'encaisser ses 6 000 €
--     (12 269 €) ;
--   - les indicateurs : les affectations réellement gagnées (6 269 €).
--
-- La bonne est la dernière : seule l'affectation sait QUEL artisan a signé.
-- `commissions_dues()` la porte, et tous les écrans la lisent.

create or replace function public.commissions_dues()
returns table (projet_id uuid, commission numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, p.commission
    from public.projets p
   where p.deleted_at is null
     and not coalesce(p.commission_encaissee, false)
     and coalesce(p.commission, 0) > 0
     and p.statut not in ('artisan_demarche', 'demarchage')
     and exists (select 1 from public.affectations a
                  where a.projet_id = p.id and a.issue = 'gagne')
     -- Mêmes règles de visibilité que les projets : chacun voit les siens.
     and (coalesce(auth.role(), '') <> 'authenticated'
          or p.id in (select public.mes_projets()));
$function$;

revoke execute on function public.commissions_dues() from public, anon;
grant execute on function public.commissions_dues() to authenticated;

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
       where deleted_at is null
         and origine = 'neuf'
         and statut not in ('mort', 'devis_signe', 'termine',
                            'artisan_demarche', 'demarchage')
    ),
    'leads_neufs_vieux', (
      select count(*) from public.projets
       where deleted_at is null
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
       where deleted_at is null
         and origine = 'reprise'
         and statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
         and assigne_a is null
    ),
    'repris_en_cours', (
      select count(*) from public.projets
       where deleted_at is null
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
       where deleted_at is null
         and origine = 'chez_artisan'
         and statut not in ('mort', 'devis_signe', 'termine')
    ),
    'chez_artisan_dormants', (
      select count(*) from public.projets p
       where p.deleted_at is null
         and p.origine = 'chez_artisan'
         and p.statut not in ('mort', 'devis_signe', 'termine')
         and p.updated_at < now() - interval '21 days'
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
      where p.statut = 'nouveau' and p.deleted_at is null
        and not exists (select 1 from public.affectations a where a.projet_id = p.id)
    ),
    -- Artisans assignés dont le contrat n'est ni signé ni externe
    'contrats', (
      select count(*) from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut not in ('perdu','termine','devis_signe')
        and p.deleted_at is null and ar.contrat_externe = false
        and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
    ),
    -- RDV passés sans suivi depuis (l'artisan n'a rien noté après le RDV)
    'rdv', (
      select count(*) from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.statut = 'rdv_pris' and af.date_rdv is not null and af.date_rdv < now()
        and p.deleted_at is null
        and not exists (select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv)
    ),
    -- Devis envoyés qui traînent (+48 h sans évolution)
    'devis', (
      select count(*) from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.statut = 'devis_envoye' and p.deleted_at is null
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
