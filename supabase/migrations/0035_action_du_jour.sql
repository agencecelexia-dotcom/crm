-- 0035 — « Action du jour » : compteurs de ce qui demande une action maintenant.
-- Alimente le bandeau d'accueil (1 coup d'œil = quoi faire aujourd'hui).

create or replace function public.action_du_jour()
returns json
language sql stable security definer set search_path = public
as $$
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
    'commissions_n', (
      select count(*) from public.projets p
      where p.deleted_at is null and p.montant_devis_signe is not null and p.commission_encaissee = false
    ),
    'commissions_total', (
      select coalesce(sum(p.commission), 0) from public.projets p
      where p.deleted_at is null and p.montant_devis_signe is not null and p.commission_encaissee = false
    )
  )
$$;
