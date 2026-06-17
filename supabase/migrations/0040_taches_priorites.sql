-- 0040 — Ordre de priorité de la to-do + valeur € (tri « les plus gros d'abord »).
-- Ordre voulu :
--   1 (haute)   : assigner un GROS projet (lead sans artisan, estimation >= 10 000 €)
--   2 (moyenne) : relancer / sécuriser (contrat à signer, devis qui traîne, RDV, commission)
--   3 (basse)   : assigner un PETIT projet (estimation < 10 000 €)
-- Dans chaque niveau, on trie par VALEUR décroissante (le plus gros d'abord).

alter table public.taches add column if not exists valeur numeric;

create or replace function public.rafraichir_taches()
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.taches where statut = 'fait' and done_at < now() - interval '24 hours';

  create temp table _act on commit drop as
    -- Assigner (gros = priorité 1, petit = priorité 3) — valeur = estimation
    select 'assign:' || p.id as cle, 'Assigner un artisan' as titre,
           trim(both ' ·' from coalesce(p.client_nom,'') || ' · ' || coalesce(p.client_ville,'') || ' · ' || coalesce(p.metier,'')) as details,
           'assignation' as categorie,
           case when coalesce(p.estimation_interne,0) >= 10000 then 1 else 3 end as priorite,
           coalesce(p.estimation_interne,0) as valeur,
           p.id as projet_id, null::uuid as artisan_id, null::text as tel
    from public.projets p
    where p.statut = 'nouveau' and p.deleted_at is null
      and not exists (select 1 from public.affectations a where a.projet_id = p.id)
  union all
    select 'contrat:' || af.id, 'Faire signer le contrat',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'contrat', 2, coalesce(p.estimation_interne,0), p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut not in ('perdu','termine','devis_signe') and p.deleted_at is null
      and ar.contrat_externe = false
      and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
  union all
    select 'devis:' || af.id, 'Relancer le devis envoyé',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'devis', 2, coalesce(p.estimation_interne,0), p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut = 'devis_envoye' and p.deleted_at is null
      and af.updated_at < now() - interval '48 hours'
  union all
    select 'rdv:' || af.id, 'Débriefer le RDV',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'rdv', 2, coalesce(p.estimation_interne,0), p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut = 'rdv_pris' and af.date_rdv is not null and af.date_rdv < now()
      and p.deleted_at is null
      and not exists (select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv)
  union all
    select 'commission:' || p.id, 'Encaisser la commission',
           coalesce(p.client_nom,'') || ' · ' || round(coalesce(p.commission,0))::text || ' €',
           'commission', 2, coalesce(p.commission,0), p.id, p.artisan_id,
           (select a2.telephone from public.artisans a2 where a2.id = p.artisan_id)
    from public.projets p
    where p.deleted_at is null and p.montant_devis_signe is not null and p.commission_encaissee = false;

  insert into public.taches (titre, details, priorite, valeur, type, categorie, projet_id, artisan_id, tel, cle_auto)
  select a.titre, a.details, a.priorite, a.valeur, 'auto', a.categorie, a.projet_id, a.artisan_id, a.tel, a.cle
  from _act a
  where not exists (select 1 from public.taches t where t.cle_auto = a.cle);

  -- Garde les priorités/valeurs à jour si l'estimation change côté CRM
  update public.taches t set priorite = a.priorite, valeur = a.valeur
  from _act a where t.cle_auto = a.cle and (t.priorite <> a.priorite or coalesce(t.valeur,-1) <> a.valeur);

  delete from public.taches t
  where t.type = 'auto' and t.statut = 'a_faire'
    and not exists (select 1 from _act a where a.cle = t.cle_auto);
end;
$$;

-- Recalcule tout de suite les priorités/valeurs des tâches auto existantes
select public.rafraichir_taches();
