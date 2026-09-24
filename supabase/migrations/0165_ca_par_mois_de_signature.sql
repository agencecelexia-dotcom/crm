-- Le chiffre d'affaires signé, rangé au mois de la SIGNATURE.
--
-- Le graphique « CA & commissions (6 mois) » lisait `projets.date_signature`,
-- renseignée sur 3 dossiers signés sur 15 : la courbe tombait à zéro en
-- juillet, août et septembre, comme si l'on ne vendait plus. `kpi_agence`,
-- elle, range par date de CRÉATION du lead — une vue par cohorte, juste, mais
-- qui ne répond pas à « combien avons-nous signé en août ? ».
--
-- Même définition que `kpi_agence` pour ne pas créer un quatrième chiffre :
-- affectations gagnées, montant signé à défaut du montant du devis,
-- commission comptée une fois par projet. Seule change la date qui range :
-- le premier suivi « devis signé » de l'affectation, à défaut la date de
-- signature du projet, à défaut la dernière mise à jour de l'affectation.

create or replace function public.ca_signe_par_mois(p_mois integer default 6)
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
       and p.statut not in ('artisan_demarche', 'demarchage')
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

-- Des chiffres d'argent : réservés aux membres qui voient les commissions.
revoke execute on function public.ca_signe_par_mois(integer) from public, anon;
grant execute on function public.ca_signe_par_mois(integer) to authenticated;
