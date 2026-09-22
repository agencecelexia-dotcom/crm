-- Le prix ne sort jamais du modèle.
--
-- CE QUI CHANGE
--
-- `devis-suggerer` (0133) interdit au modèle d'inventer un prix — mais par
-- CONSIGNE. Une consigne se contourne : il suffit que le modèle décide qu'un
-- échafaudage « vaut bien » 1 500 €, et le devis part à trois fois le marché.
-- C'est exactement ce qui a fait perdre Ledent et Pancagene.
--
-- On retire donc la décision au modèle. Il propose des DÉSIGNATIONS et des
-- QUANTITÉS ; c'est la base qui y attache les prix, depuis deux sources et
-- deux seulement :
--
--   1. la bibliothèque de l'artisan — ses prix à lui, les plus justes ;
--   2. le référentiel du métier — la médiane des devis observés, et seulement
--      si la règle de confidentialité (0133) la rend visible à cet artisan.
--
-- À défaut, la ligne arrive SANS PRIX, marquée « à chiffrer ». Une case vide
-- se voit ; un prix faux, non.
--
-- LA MARGE VISÉE
--
-- « L'IA prend en compte de combien il veut marger. » La marge se calcule sur
-- le prix de vente : PV = déboursé / (1 − marge). Une marge de 35 % sur un
-- déboursé de 26 € donne donc 40 €, et non 35,10 €.
--
-- Elle ne s'applique qu'aux lignes dont on connaît le déboursé : sans coût, il
-- n'y a pas de marge à viser, et recalculer un prix de vente à partir de rien
-- serait inventer.

create or replace function public.garnir_lignes_by_token(
  p_token       text,
  p_lignes      jsonb,
  p_metier      text default null,
  -- Fraction, pas pourcentage : 0.35 pour 35 %.
  p_marge_cible numeric default null
)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id    uuid;
  v_marge numeric;
  v_ref   json;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  -- Une marge se situe entre 0 et 80 %. Au-delà, le prix de vente diverge :
  -- à 100 %, la formule tend vers l'infini.
  v_marge := case
               when p_marge_cible is null then null
               when p_marge_cible <= 0 or p_marge_cible >= 0.8 then null
               else p_marge_cible
             end;

  -- Calculé UNE fois : `reference_metier` regroupe tout le corpus du métier à
  -- chaque appel, ce qu'on ne veut pas refaire par ligne.
  v_ref := case when p_metier is not null
                then public.reference_metier(p_metier, 60, v_id)
                else '[]'::json end;

  return json_build_object('ok', true, 'lignes', (
    select coalesce(json_agg(
      json_build_object(
        'designation',   e.designation,
        'unite',         coalesce(b.unite, r.unite, e.unite, 'u'),
        'quantite',      coalesce(e.quantite, 1),
        'cout_unitaire', b.cout_unitaire,
        'prix_unitaire', case
          -- Marge visée : elle ne s'applique qu'avec un déboursé connu.
          when v_marge is not null and b.cout_unitaire is not null
            then round(b.cout_unitaire / (1 - v_marge), 2)
          else coalesce(b.prix_unitaire, r.prix)
        end,
        'source', case
          when v_marge is not null and b.cout_unitaire is not null then 'marge'
          when b.prix_unitaire is not null then 'bibliotheque'
          when r.prix is not null          then 'reference'
          else 'a_chiffrer'
        end)
      order by e.i), '[]'::json)
    from (
      select t.ordinality                          as i,
             btrim(t.l->>'designation')            as designation,
             nullif(btrim(coalesce(t.l->>'unite', '')), '') as unite,
             nullif(t.l->>'quantite', '')::numeric  as quantite,
             public.normaliser_designation(t.l->>'designation') as norme
        from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb))
             with ordinality as t(l, ordinality)
       where coalesce(btrim(t.l->>'designation'), '') <> ''
    ) e
    -- Sa bibliothèque d'abord : son prix vaut mieux qu'une médiane.
    left join lateral (
      select dp.unite, dp.prix_unitaire, dp.cout_unitaire
        from public.devis_prix dp
       where dp.artisan_id = v_id
         and public.meme_ouvrage(public.normaliser_designation(dp.designation), e.norme)
       order by dp.utilisations desc, dp.derniere_utilisation desc nulls last
       limit 1
    ) b on true
    -- Puis le référentiel, dont le prix peut être masqué par la règle de
    -- confidentialité — auquel cas la ligne repart « à chiffrer ».
    left join lateral (
      select x->>'unite' as unite, nullif(x->>'prix_median', '')::numeric as prix
        from json_array_elements(v_ref) x
       where public.meme_ouvrage(public.normaliser_designation(x->>'designation'), e.norme)
       limit 1
    ) r on true
  ));
end
$function$;

revoke execute on function public.garnir_lignes_by_token(text, jsonb, text, numeric) from public;
grant execute on function public.garnir_lignes_by_token(text, jsonb, text, numeric) to anon, authenticated;
