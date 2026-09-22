-- Le devis type garni de SES prix.
--
-- LE TROU
--
-- Le corpus est aujourd'hui alimenté par une seule entreprise. La règle de
-- confidentialité de 0133 — un prix ne sort que si trois entreprises au moins
-- l'alimentent, ou si le destinataire en est l'auteur — fait donc que TOUT
-- artisan autre que celui-là reçoit le devis type avec huit désignations et
-- pas un seul prix.
--
-- C'est correct, et c'est insuffisant : un modèle sans prix fait gagner la
-- moitié du temps promis.
--
-- CE QU'ON PEUT FAIRE SANS RIEN DÉVOILER
--
-- L'artisan a sa propre bibliothèque (`devis_prix`), remplie par ses devis
-- précédents. Si l'une de ses lignes décrit le même ouvrage, c'est SON prix
-- qui garnit le modèle. Rien ne sort de chez personne, et dès le deuxième
-- devis d'un métier, le modèle arrive complet.
--
-- Son prix l'emporte d'ailleurs même quand la médiane du corpus est visible :
-- ce qu'il facture aujourd'hui vaut mieux qu'une médiane sur deux ans.
--
-- RAPPROCHER DEUX DÉSIGNATIONS
--
-- L'étiquette du modèle vient du corpus (« Nettoyage haute pression du support
-- (façade) ») tandis que sa bibliothèque porte ses mots à lui (« Nettoyage HP
-- façade »). Une égalité stricte ne rapprocherait presque rien. On réutilise
-- donc la règle de 0136, qui devient une fonction à part entière — seule
-- définition de « même ouvrage » dans toute la base.
--
-- LE SEUIL, CORRIGÉ DE 70 % À 60 %
--
-- « Nettoyage HP façade » et « Nettoyage haute pression du support (façade) »
-- partagent deux mots sur trois : 66 %, soit juste sous l'ancien seuil. Le
-- même ouvrage restait donc séparé de lui-même.
--
-- Mesuré avant de trancher : sur tout le corpus façade, DEUX paires seulement
-- tombent entre 60 % et 70 %, et toutes deux sont de vrais rapprochements —
--
--   « Installation de chantier, protection des… » / « Protection des
--     menuiseries et abords »                                         0,667
--   « Protection des menuiseries, portes de garage… » / « Protection des
--     abords (menuiseries, sol, végétaux) »                           0,600
--
-- Descendre à 60 % ne relâche donc rien : cela corrige. Le garde-fou n'a
-- jamais été le ratio mais le PLANCHER DE DEUX MOTS COMMUNS, qui maintient le
-- nettoyage de façade (un seul mot partagé) distinct du nettoyage de chantier
-- quel que soit le seuil.

create or replace function public.meme_ouvrage(a text, b text)
returns boolean
language sql
immutable
set search_path to 'pg_temp'
as $function$
  select case
    when a is null or b is null then false
    when a = b                  then true
    else (
      select count(*) >= 2
         and count(*)::numeric
             / least(cardinality(string_to_array(a, ' ')),
                     cardinality(string_to_array(b, ' '))) >= 0.6
        from (select unnest(string_to_array(a, ' '))
              intersect
              select unnest(string_to_array(b, ' '))) s
    )
  end;
$function$;

revoke execute on function public.meme_ouvrage(text, text) from public;

-- `grouper_ouvrages` s'appuie désormais sur elle : une seule règle, un seul
-- endroit où la corriger.

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
    v_trouve := null;

    for i in 1 .. coalesce(array_length(v_tetes, 1), 0) loop
      if public.meme_ouvrage(r.norm, v_tetes[i]) then
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

-- ---------- Le modèle, garni de ses prix quand il en a ----------

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

  -- Les huit ouvrages les plus fréquents du métier, rangés dans l'ordre des
  -- travaux, garnis de SON prix dès qu'il en a un pour le même ouvrage — à
  -- défaut de la médiane du corpus, elle-même masquée tant que la fourchette
  -- n'est pas assez collective pour ne désigner personne.
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
                 public.normaliser_designation(r->>'designation'))
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
