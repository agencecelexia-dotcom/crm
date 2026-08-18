-- Chantiers sortis du pipe d'un artisan mais encore vivants.
--
-- L'agence ne les voyait nulle part. Un chantier retiré ou déclaré perdu par
-- un artisan reste un lead exploitable : le client n'a pas disparu, c'est
-- l'artisan qui a renoncé. Sans vue dédiée, ces dossiers se perdaient — 80 en
-- prod au moment de la migration (46 retraits, 34 pertes).
--
-- On distingue trois natures, car elles n'appellent pas la même action :
--   'retrait' — l'artisan a rendu le chantier (hors zone, trop petit, occupé)
--   'perdu'   — le client a dit non à CET artisan, un autre peut réussir
--   'masque'  — l'agence l'avait retiré du pipe de l'artisan
--
-- Un projet déjà repris par quelqu'un d'autre, mort, ou gagné n'apparaît pas :
-- il n'y a plus rien à réattribuer.

create or replace function public.chantiers_a_reattribuer()
returns json
language sql
security definer
set search_path = public, pg_temp
as $$
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
      coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
      case
        when af.retire_at is not null then 'retrait'
        when af.statut = 'perdu'      then 'perdu'
        else 'masque'
      end as nature,
      -- Le dernier commentaire dit souvent pourquoi ça a échoué : c'est
      -- l'élément qui décide d'une réattribution.
      (select s.message from public.suivis s
        where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
        order by s.created_at desc limit 1) as derniere_raison,
      -- Combien d'artisans travaillent encore dessus. À zéro, plus personne
      -- ne s'en occupe : ce sont les dossiers vraiment orphelins.
      (select count(*) from public.affectations af2
        where af2.projet_id = p.id and af2.retire_at is null
          and af2.statut <> 'perdu') as artisans_actifs
    from public.affectations af
    join public.projets p on p.id = af.projet_id
    left join public.artisans a on a.id = af.artisan_id
    where p.deleted_at is null
      -- Un projet gagné, mort ou clos n'a plus rien à réattribuer.
      and p.statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
      and (af.retire_at is not null or af.masque_at is not null or af.statut = 'perdu')
  ) x;
$$;

comment on function public.chantiers_a_reattribuer() is
  'Chantiers rendus ou perdus par un artisan alors que le projet reste vivant. Sert à la réattribution côté agence.';

revoke execute on function public.chantiers_a_reattribuer() from public, anon;
grant execute on function public.chantiers_a_reattribuer() to authenticated;
