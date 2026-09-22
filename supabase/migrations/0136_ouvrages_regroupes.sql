-- Regrouper ce qui est le même ouvrage.
--
-- LE DÉFAUT
--
-- 0133 regroupe les lignes par désignation normalisée identique. Sur les 109
-- devis lus, le métier « Façade / Ravalement » sort alors NEUF familles de
-- nettoyage là où il n'y a que deux ouvrages :
--
--   chantier dechet evacuation fin nettoyage     9 fois
--   chantier fin nettoyage                       7
--   chantier evacuation gravat nettoyage         1
--   chantier complet dechet evacuation nettoyage 1   ← un seul ouvrage, 18 obs.
--
--   facade haute nettoyage pression support      6
--   degraissage demoussage … facade haute …      5   ← un autre, 11 obs.
--
-- Conséquence : le devis type proposait DEUX lignes de nettoyage de chantier,
-- et chacune sur un échantillon deux fois trop petit. Pour une fonction dont
-- tout l'argument est « un clic et c'est juste », c'est disqualifiant.
--
-- LA RÈGLE
--
-- Deux désignations décrivent le même ouvrage quand leurs mots se recouvrent
-- assez : au moins deux mots communs, et un recouvrement d'au moins 70 %
-- rapporté à la plus courte des deux.
--
--   « chantier fin nettoyage » ⊂ « chantier dechet evacuation fin nettoyage »
--     → 3 mots communs sur 3 = 100 %          → même ouvrage
--
--   « chantier fin nettoyage » vs « facade haute nettoyage pression support »
--     → 1 seul mot commun                     → ouvrages distincts
--
-- Le seuil de deux mots communs est ce qui empêche « nettoyage » à lui seul de
-- tout agglomérer : sans lui, le nettoyage de façade et celui du chantier
-- fusionneraient, et le devis type oublierait une ligne facturée à chaque fois.
--
-- Le regroupement est GLOUTON, par fréquence décroissante : la formulation la
-- plus courante devient la tête de famille, les variantes la rejoignent. Aucune
-- chaîne transitive — une variante ne rejoint qu'une tête, jamais une variante.

create or replace function public.grouper_ouvrages(p_metier text)
returns table (norme text, tete text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r        record;
  v_tetes  text[] := '{}';   -- les têtes de famille, par fréquence décroissante
  v_toks   text[];
  v_tt     text[];
  v_inter  int;
  v_trouve text;
  i        int;
begin
  for r in
    select dr.designation_norm as norm, count(*) as n
      from public.devis_ligne_ref dr
     where (p_metier is null or dr.metier = p_metier)
       and dr.prix_unitaire is not null
     group by dr.designation_norm
     order by count(*) desc, dr.designation_norm
  loop
    v_toks := string_to_array(r.norm, ' ');
    v_trouve := null;

    for i in 1 .. coalesce(array_length(v_tetes, 1), 0) loop
      v_tt := string_to_array(v_tetes[i], ' ');
      select count(*) into v_inter
        from (select unnest(v_toks) intersect select unnest(v_tt)) s;

      if v_inter >= 2
         and v_inter::numeric
             / least(cardinality(v_toks), cardinality(v_tt)) >= 0.7 then
        v_trouve := v_tetes[i];
        exit;
      end if;
    end loop;

    if v_trouve is null then
      v_tetes := v_tetes || r.norm;
      v_trouve := r.norm;
    end if;

    norme := r.norm;
    tete  := v_trouve;
    return next;
  end loop;
end
$function$;

revoke execute on function public.grouper_ouvrages(text) from public;

-- `reference_metier` groupe désormais par famille plutôt que par désignation
-- exacte. Tout le reste est inchangé, règle de confidentialité comprise :
-- l'artisan voit toujours ses propres prix, ceux des autres seulement quand
-- trois entreprises au moins alimentent la famille.
--
-- Cette règle SE RENFORCE du regroupement : une famille rassemble plus
-- d'entreprises qu'une désignation isolée, donc plus de prix deviennent
-- visibles — sans jamais qu'un prix puisse être attribué à quelqu'un.

create or replace function public.reference_metier(
  p_metier text,
  p_limite int default 40,
  p_pour_artisan uuid default null
)
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(json_agg(x order by x.n desc), '[]'::json)
  from (
    select
      -- La formulation la plus fréquente de la famille sert d'étiquette.
      mode() within group (order by r.designation) as designation,
      mode() within group (order by r.unite)       as unite,
      count(*)::int                                as n,
      count(distinct r.artisan_id)::int            as nb_artisans,
      (p_pour_artisan is null
        or count(distinct r.artisan_id) >= 3
        or count(*) filter (where r.artisan_id is distinct from p_pour_artisan) = 0
      ) as prix_visible,
      round(percentile_cont(0.5)  within group (order by r.prix_unitaire)::numeric, 2) as p50,
      round(percentile_cont(0.25) within group (order by r.prix_unitaire)::numeric, 2) as p25,
      round(percentile_cont(0.75) within group (order by r.prix_unitaire)::numeric, 2) as p75
    from public.devis_ligne_ref r
    join public.grouper_ouvrages(p_metier) g on g.norme = r.designation_norm
    where (p_metier is null or r.metier = p_metier)
      and r.prix_unitaire is not null
    group by g.tete
    order by count(*) desc
    limit greatest(p_limite, 1)
  ) x0,
  lateral (
    select x0.designation, x0.unite, x0.n, x0.nb_artisans,
           case when x0.prix_visible then x0.p50 end as prix_median,
           case when x0.prix_visible then x0.p25 end as prix_bas,
           case when x0.prix_visible then x0.p75 end as prix_haut
  ) x;
$function$;

revoke execute on function public.reference_metier(text, int, uuid) from public;
grant execute on function public.reference_metier(text, int, uuid) to authenticated;
