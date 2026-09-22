-- Une racine, et deux seuils selon ce qu'on risque.
--
-- LA RACINE
--
-- `normaliser_designation` retire les pluriels mais pas les accords : pour
-- elle, « enduit traditionnel » et « enduit traditionnelle » n'ont qu'un mot
-- en commun. Les désignations d'un devis sont pourtant écrites à la volée, au
-- masculin comme au féminin, au singulier comme au pluriel.
--
-- On compare donc des RACINES DE CINQ LETTRES plutôt que des mots entiers :
-- « traditionnel » et « traditionnelle » donnent tous deux « tradi », comme
-- « protection » et « protéger » donnent « prote ». C'est grossier, et c'est
-- ce que font les moteurs de recherche depuis trente ans, parce que sur des
-- désignations de trois à huit mots cela suffit.
--
-- Le garde-fou tient : « nettoyage de fin de chantier » et « nettoyage haute
-- pression de la façade » partagent toujours le seul mot « netto », donc
-- restent deux ouvrages distincts.
--
-- DEUX SEUILS, PARCE QUE LE RISQUE N'EST PAS LE MÊME
--
-- Mesuré sur le corpus façade, la bande 50–60 % contient six paires. Cinq sont
-- de vrais rapprochements (protection des abords, rebouchage de fissures,
-- enduit de finition). La sixième ne l'est pas :
--
--   « Application enduit de finition crépi taloché »
--   « Crépi de finition sur ITE (mince ou épais) »
--
-- Le même geste sur deux supports différents, donc deux prix différents. Les
-- fondre corromprait une médiane, en silence et pour toujours.
--
-- D'où deux usages du même outil :
--
--   REGROUPER le corpus        → 60 %. Une erreur y est invisible et durable.
--   GARNIR un devis en cours   → 50 %. Une erreur y est sous les yeux de
--                                 l'artisan, qui corrige la ligne — et une
--                                 ligne manquante lui coûte une saisie.

drop function if exists public.meme_ouvrage(text, text);

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
    select count(*) n from (
      select unnest((select t from ra)) intersect select unnest((select t from rb))) s)
  select case
    when a is null or b is null then false
    when a = b                  then true
    when (select t from ra) is null or (select t from rb) is null then false
    else (select n from inter) >= 2
         and (select n from inter)::numeric
             / least(cardinality((select t from ra)),
                     cardinality((select t from rb))) >= p_seuil
  end;
$function$;

revoke execute on function public.meme_ouvrage(text, text, numeric) from public;

-- ---------- Garnir : 50 % ----------

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
  v_id    uuid;
  v_marge numeric;
  v_ref   json;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  v_marge := case
               when p_marge_cible is null then null
               when p_marge_cible <= 0 or p_marge_cible >= 0.8 then null
               else p_marge_cible
             end;

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
        from json_array_elements(v_ref) x
       where public.meme_ouvrage(public.normaliser_designation(x->>'designation'), e.norme, 0.5)
       limit 1
    ) r on true
  ));
end
$function$;

revoke execute on function public.garnir_lignes_by_token(text, jsonb, text, numeric) from public;
grant execute on function public.garnir_lignes_by_token(text, jsonb, text, numeric) to anon, authenticated;

-- ---------- Le devis type puise aussi dans sa bibliothèque à 50 % ----------

create or replace function public.modeles_by_token(p_token text, p_metier text default null)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_siens json;
  v_type json;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then return '[]'::json; end if;

  select coalesce(json_agg(json_build_object(
           'id', m.id, 'nom', m.nom, 'metier', m.metier,
           'lignes', m.lignes, 'nb_lignes', jsonb_array_length(m.lignes),
           'source', 'perso')
         order by m.utilisations desc, m.created_at desc), '[]'::json)
    into v_siens
    from public.devis_modele m
   where m.artisan_id = v_id
     and (p_metier is null or m.metier is null or m.metier = p_metier);

  if p_metier is not null then
    select case when count(*) >= 3 then
      json_build_array(json_build_object(
        'id', null,
        'nom', 'Devis type — ' || p_metier,
        'metier', p_metier,
        'nb_lignes', count(*),
        'source', 'reference',
        'lignes', json_agg(json_build_object(
          'designation', r->>'designation',
          'unite', coalesce(p.unite, r->>'unite', 'u'),
          'quantite', 1,
          'prix_unitaire', coalesce(p.prix_unitaire, nullif(r->>'prix_median', '')::numeric),
          'cout_unitaire', p.cout_unitaire)
          order by coalesce((r->>'rang')::numeric, 1), (r->>'designation'))))
    end
      into v_type
      from json_array_elements(public.reference_metier(p_metier, 8, v_id)) r
      left join lateral (
        select dp.unite, dp.prix_unitaire, dp.cout_unitaire
          from public.devis_prix dp
         where dp.artisan_id = v_id
           and public.meme_ouvrage(
                 public.normaliser_designation(dp.designation),
                 public.normaliser_designation(r->>'designation'), 0.5)
         order by dp.utilisations desc, dp.derniere_utilisation desc nulls last
         limit 1
      ) p on true;
  end if;

  return (
    select json_agg(x) from (
      select * from json_array_elements(v_siens)
      union all
      select * from json_array_elements(coalesce(v_type, '[]'::json))
    ) t(x)
  );
end
$function$;

revoke execute on function public.modeles_by_token(text, text) from public;
grant execute on function public.modeles_by_token(text, text) to anon, authenticated;
