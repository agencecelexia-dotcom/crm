-- Un prix de référence ne s'attache plus par ressemblance.
--
-- Trouvé par l'audit du devis, en rejouant le rattachement en base : la
-- référence (prix médians observés chez les devis de l'agence) était attachée
-- aux lignes de l'IA par meme_ouvrage(…, 0,5), et son UNITÉ remplaçait celle
-- du modèle. Résultat : un nettoyage de gouttières chiffré 7 070 € HT, des
-- poteaux facturés 97 €/ml au prix d'une clôture, un débouchage au prix d'une
-- descente neuve (2 942 €, sur UN seul devis observé) — alors que l'écran
-- affiche « rien n'a été inventé ».
--
-- Désormais un prix ne s'attache que si l'ouvrage est le MÊME (libellé
-- normalisé identique), dans la MÊME unité, et, pour la référence, s'il repose
-- sur au moins trois devis. L'unité du modèle n'est plus jamais remplacée. Le
-- nombre de devis observés est renvoyé avec le prix.

CREATE OR REPLACE FUNCTION public.garnir_lignes_by_token(p_token text, p_lignes jsonb, p_metier text DEFAULT NULL::text, p_marge_cible numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id      uuid;
  v_metiers text[];
  v_marge   numeric;
  v_ref     jsonb := '[]'::jsonb;
  m         text;
begin
  select id, coalesce(metiers, '{}') into v_id, v_metiers
    from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  v_marge := case
               when p_marge_cible is null then null
               when p_marge_cible <= 0 or p_marge_cible >= 0.8 then null
               else p_marge_cible
             end;

  foreach m in array (
    case when p_metier is not null then array[p_metier] else v_metiers[1:8] end
  ) loop
    v_ref := v_ref || public.reference_metier(m, 60, v_id)::jsonb;
  end loop;

  return json_build_object('ok', true, 'lignes', (
    select coalesce(json_agg(
      json_build_object(
        'designation',   e.designation,
        -- L'unité du MODÈLE fait foi : un prix n'est attaché que dans la même
        -- unité (voir plus bas), il ne peut donc plus la remplacer.
        'unite',         coalesce(e.unite, b.unite, r.unite, 'u'),
        'quantite',      coalesce(e.quantite, 1),
        'cout_unitaire', b.cout_unitaire,
        'prix_unitaire', case
          when v_marge is not null and b.cout_unitaire is not null
            then round(b.cout_unitaire / (1 - v_marge), 2)
          else coalesce(b.prix_unitaire, r.prix)
        end,
        'source', case
          when v_marge is not null and b.cout_unitaire is not null then 'marge'
          when b.prix_unitaire is not null then 'bibliotheque'
          when r.prix is not null          then 'reference'
          else 'a_chiffrer'
        end,
        -- Combien de devis derrière un prix de référence : « prix observé »
        -- ne veut pas dire la même chose sur 3 devis et sur 40.
        'observations', r.n)
      order by e.i), '[]'::json)
    from (
      select t.ordinality                          as i,
             btrim(t.l->>'designation')            as designation,
             nullif(btrim(coalesce(t.l->>'unite', '')), '') as unite,
             nullif(t.l->>'quantite', '')::numeric  as quantite,
             -- L'identifiant que le modèle a rendu, s'il a repris une ligne.
             -- Une valeur qui n'est pas un UUID est simplement ignorée.
             case when t.l->>'prix_id' ~
                       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then (t.l->>'prix_id')::uuid end   as prix_id,
             public.normaliser_designation(t.l->>'designation') as norme
        from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb))
             with ordinality as t(l, ordinality)
       where coalesce(btrim(t.l->>'designation'), '') <> ''
    ) e
    -- La bibliothèque : PAR IDENTIFIANT, jamais par ressemblance. Le filtre sur
    -- `artisan_id` reste indispensable — un identifiant se devine mal, mais il
    -- se recopie, et rien ne doit permettre de lire le tarif d'un autre.
    left join lateral (
      select dp.unite, dp.prix_unitaire, dp.cout_unitaire
        from public.devis_prix dp
       where dp.id = e.prix_id
         and dp.artisan_id = v_id
         -- Même identifiant mais autre unité : le prix ne vaut pas pour cette
         -- ligne (un prix au mètre n'est pas un prix à l'unité).
         and (e.unite is null
              or public.normaliser_unite(dp.unite) = public.normaliser_unite(e.unite))
    ) b on true
    left join lateral (
      select x->>'unite' as unite,
             nullif(x->>'prix_median', '')::numeric as prix,
             nullif(x->>'n', '')::int as n
        from jsonb_array_elements(v_ref) x
       -- LE MÊME OUVRAGE, PAS UN OUVRAGE QUI LUI RESSEMBLE. Le rapprochement
       -- flou (seuil 0,5) chiffrait « Débouchage des descentes EP » au prix
       -- d'une « Descente d'eaux pluviales (fourniture et pose) », des poteaux
       -- au mètre linéaire d'une clôture entière, un nettoyage de 25 ml de
       -- gouttières à 7 070 € HT. Une désignation citant l'ouvrage voisin
       -- ramenait son prix. Désormais : libellé normalisé identique, même
       -- unité, et au moins trois devis observés — sinon la ligne arrive « à
       -- chiffrer », et c'est l'artisan qui met son prix.
       where public.normaliser_designation(x->>'designation') = e.norme
         and (e.unite is null
              or public.normaliser_unite(x->>'unite') = public.normaliser_unite(e.unite))
         and nullif(x->>'prix_median', '') is not null
         and coalesce(nullif(x->>'n', '')::int, 0) >= 3
       limit 1
    ) r on true
  ));
end
$function$

;
