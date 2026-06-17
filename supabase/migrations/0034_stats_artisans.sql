-- 0034 — Statistiques de performance par artisan.
-- Pour décider à qui confier les gros leads : qui signe, qui répond vite, qui perd.
-- Note : les affectations perdantes sont supprimées quand un autre gagne, donc
-- "gagnés" se lit sur projets.artisan_id (le gagnant y reste), "en cours/perdus"
-- sur les affectations encore présentes, et le délai de réponse sur le 1er suivi.

create or replace function public.stats_artisans()
returns json
language sql stable security definer set search_path = public
as $$
  select coalesce(
    json_agg(
      json_build_object(
        'id', id, 'nom', nom,
        'gagnes', gagnes, 'ca_signe', ca_signe, 'commission', commission,
        'en_cours', en_cours, 'perdus', perdus,
        'taux', case when (gagnes + perdus) > 0
                     then round(gagnes::numeric * 100 / (gagnes + perdus)) else null end,
        'delai_h', delai_h
      )
      order by ca_signe desc, gagnes desc
    ), '[]'::json
  )
  from (
    select
      a.id,
      coalesce(a.societe, nullif(trim(coalesce(a.prenom,'') || ' ' || coalesce(a.nom,'')), '')) as nom,
      g.gagnes, g.ca_signe, g.commission,
      c.en_cours, c.perdus, d.delai_h
    from public.artisans a
    left join lateral (
      select count(*) as gagnes,
             coalesce(sum(p.montant_devis_signe), 0) as ca_signe,
             coalesce(sum(p.commission), 0) as commission
      from public.projets p
      where p.artisan_id = a.id and p.deleted_at is null
        and p.statut in ('devis_signe', 'termine')
    ) g on true
    left join lateral (
      select
        count(*) filter (where af.statut in ('artisan_assigne','contacte','rdv_pris','en_attente','devis_envoye')) as en_cours,
        count(*) filter (where af.statut = 'perdu') as perdus
      from public.affectations af
      join public.projets p2 on p2.id = af.projet_id
      where af.artisan_id = a.id and p2.deleted_at is null
    ) c on true
    left join lateral (
      select round(avg(extract(epoch from (fs.first_at - af.created_at)) / 3600)::numeric, 1) as delai_h
      from public.affectations af
      join lateral (
        select min(s.created_at) as first_at
        from public.suivis s where s.affectation_id = af.id and s.auteur = 'artisan'
      ) fs on true
      where af.artisan_id = a.id and fs.first_at is not null
    ) d on true
    where g.gagnes > 0 or c.en_cours > 0 or c.perdus > 0
  ) t
$$;
