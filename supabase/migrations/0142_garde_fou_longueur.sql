-- Une désignation longue ne doit pas devenir un attrape-tout.
--
-- LE DÉFAUT, TROUVÉ PAR L'AUDIT
--
-- `meme_ouvrage` rapporte les mots communs AU PLUS COURT des deux désignations.
-- Une désignation longue contient donc mécaniquement tous les mots d'une
-- désignation courte, et le ratio vaut 1,00 quoi qu'il arrive.
--
-- Constaté sur la bibliothèque d'un artisan : une ligne de 49 mots décrivant
-- des raccords de peinture — qui mentionne au passage « évacuation des déchets
-- de chantier » et « nettoyage soigné » — décrochait la ligne « Nettoyage de
-- fin de chantier » et lui collait son prix, 33,33 €, marqué « votre prix ».
--
-- Et le corpus en souffrait déjà, dans l'autre sens : le libellé COURT
-- « Gouttière (fourniture et pose) » servait d'aimant à tout ce qui commence
-- par « Fourniture et pose de… » —
--
--   Fourniture et pose d'un portillon grillagé        ↔ Gouttière   4,3×
--   Fourniture et pose de grillage rigide sur poteaux ↔ Gouttière   3,7×
--   Fourniture et pose d'un portail coulissant        ↔ Gouttière   3,0×
--   Traitement anti-humidité hydrofuge du mur ↔ Traitement de Support 4,0×
--
-- Des prix de gouttière entraient donc dans la médiane des poteaux de clôture.
-- Le devis type « Clôture » était faux depuis 0136, sans que rien ne le montre.
--
-- LA RÈGLE AJOUTÉE
--
-- Deux désignations ne décrivent le même ouvrage que si leurs longueurs sont
-- comparables : la plus longue ne dépasse pas le DOUBLE de la plus courte.
-- Au-delà, la longue est un ouvrage composite, pas une reformulation.
--
-- Mesuré avant de trancher : sur les 108 rapprochements que le corpus produit
-- aujourd'hui, 21 tombent — et les vingt-et-un sont de faux rapprochements.
-- Les cas légitimes passent tous largement :
--
--   « Nettoyage HP façade » / « Nettoyage haute pression du support »  1,67×
--   « Installation échafaudage » / « … échafaudage de pied »           1,50×
--   « Enduit traditionnel trois couches » / « … gobetis + corps… »     1,25×
--
-- DEUXIÈME RÈGLE : PARTAGER UN NOM D'OUVRAGE, PAS DEUX MOTS DE REMPLISSAGE
--
-- Le garde-fou de longueur ne suffit pas. « Gouttière (fourniture et pose) » et
-- « Fourniture et pose d'un portail coulissant » sont de longueurs proches et
-- partagent deux mots — « fourniture » et « pose ». Aucun des deux ne désigne
-- quoi que ce soit : ce sont les mots que TOUTE ligne de devis emploie.
--
-- Les mots communs doivent donc comporter au moins un mot PORTEUR. Gouttière et
-- portail ne partagent que du remplissage : ce sont deux ouvrages.

create or replace function public.meme_ouvrage(a text, b text, p_seuil numeric default 0.6)
returns boolean
language sql
immutable
set search_path to 'pg_temp'
as $function$
  with ra as (
    select array_agg(distinct case when length(w) > 5 then left(w, 5) else w end) t
      from unnest(string_to_array(coalesce(a, ''), ' ')) w where w <> ''),
  rb as (
    select array_agg(distinct case when length(w) > 5 then left(w, 5) else w end) t
      from unnest(string_to_array(coalesce(b, ''), ' ')) w where w <> ''),
  inter as (
    select count(*) n,
           -- Mots communs qui désignent vraiment quelque chose. « Fourniture »
           -- et « pose » figurent sur toutes les lignes de tous les devis :
           -- les compter comme preuve reviendrait à tout rapprocher.
           count(*) filter (where s.w not in (
             'fourn','pose','poser','insta','appli','mise','oeuvr','trava',
             'reali','compr','ensem','forfa','prest','unite','prix','divers',
             'pieces','piece','ml','m2','m3','par','sur','avec','tout','type'
           )) as porteurs
      from (select unnest((select t from ra)) w
            intersect
            select unnest((select t from rb))) s)
  select case
    when a is null or b is null then false
    when a = b                  then true
    when (select t from ra) is null or (select t from rb) is null then false
    -- Longueurs comparables : au-delà du double, la plus longue décrit un
    -- ouvrage composite, dont la courte n'est qu'une partie. Sans ce garde-fou,
    -- le rapport ci-dessous vaut 1,00 dès que la longue contient la courte.
    when greatest(cardinality((select t from ra)), cardinality((select t from rb)))::numeric
         / least(cardinality((select t from ra)), cardinality((select t from rb))) > 2
      then false
    -- Au moins un mot porteur en commun, et deux mots en tout.
    when (select porteurs from inter) < 1 then false
    else (select n from inter) >= 2
         and (select n from inter)::numeric
             / least(cardinality((select t from ra)),
                     cardinality((select t from rb))) >= p_seuil
  end;
$function$;

revoke execute on function public.meme_ouvrage(text, text, numeric) from public;

-- ---------- Un devis sans chantier doit quand même se chiffrer ----------
--
-- Deuxième défaut de l'audit : depuis « Nouveau devis », sans chantier
-- d'origine, aucun métier n'est transmis. `garnir_lignes_by_token` ne
-- consultait alors aucun référentiel, et TOUTES les lignes revenaient « à
-- chiffrer ». Sur sept descriptions dans six métiers, pas un prix.
--
-- L'artisan déclare pourtant ses métiers sur sa fiche. À défaut de métier
-- transmis, on interroge donc le référentiel de CHACUN des siens.

create or replace function public.garnir_lignes_by_token(
  p_token       text,
  p_lignes      jsonb,
  p_metier      text default null,
  p_marge_cible numeric default null
)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- Le métier transmis s'il existe, sinon tous ceux que l'artisan déclare.
  -- Huit au plus : au-delà, le temps de réponse se dégraderait pour un gain
  -- nul, un artisan n'exerçant pas huit métiers sur un même chantier.
  foreach m in array (
    case when p_metier is not null then array[p_metier] else v_metiers[1:8] end
  ) loop
    v_ref := v_ref || public.reference_metier(m, 60, v_id)::jsonb;
  end loop;

  return json_build_object('ok', true, 'metiers_consultes',
    case when p_metier is not null then array[p_metier] else v_metiers[1:8] end, 'lignes', (
    select coalesce(json_agg(
      json_build_object(
        'designation',   e.designation,
        'unite',         coalesce(b.unite, r.unite, e.unite, 'u'),
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
    left join lateral (
      select dp.unite, dp.prix_unitaire, dp.cout_unitaire
        from public.devis_prix dp
       where dp.artisan_id = v_id
         and public.meme_ouvrage(public.normaliser_designation(dp.designation), e.norme, 0.5)
       order by dp.utilisations desc, dp.derniere_utilisation desc nulls last
       limit 1
    ) b on true
    left join lateral (
      select x->>'unite' as unite, nullif(x->>'prix_median', '')::numeric as prix
        from jsonb_array_elements(v_ref) x
       where public.meme_ouvrage(public.normaliser_designation(x->>'designation'), e.norme, 0.5)
         and nullif(x->>'prix_median', '') is not null
       limit 1
    ) r on true
  ));
end
$function$;

revoke execute on function public.garnir_lignes_by_token(text, jsonb, text, numeric) from public;
grant execute on function public.garnir_lignes_by_token(text, jsonb, text, numeric) to anon, authenticated;
