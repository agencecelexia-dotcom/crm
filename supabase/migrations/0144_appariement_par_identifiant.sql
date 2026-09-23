-- Le prix de la bibliothèque ne s'attrape plus par ressemblance.
--
-- CE QUE LE SECOND AUDIT A MONTRÉ
--
-- La ressemblance entre libellés, même corrigée par le garde-fou de longueur
-- et la règle du mot porteur (0142), reste un mauvais juge :
--
--   « Poteaux aluminium pour clôture panneaux rigides »
--   ↔ « Clôture en panneaux rigides hauteur 1,80 m »     58,88 €/ml
--
-- Trois mots porteurs en commun — clôture, panneaux, rigides — et des
-- longueurs voisines. La règle passe. Pourtant un poteau n'est pas une
-- clôture : c'est la pièce qui la tient, elle se compte à l'unité, et lui
-- appliquer le prix du mètre de clôture gonfle le devis.
--
-- Le défaut est de principe : une désignation cite souvent l'ouvrage auquel
-- elle appartient. « Poteaux POUR clôture », « raccords AUTOUR des fenêtres »,
-- « finitions SUR l'enduit ». Un sac de mots ne distingue pas le sujet du
-- complément, et aucun seuil ne l'y aidera.
--
-- CE QU'ON FAIT À LA PLACE
--
-- Le modèle reçoit le catalogue AVEC UN IDENTIFIANT par ligne. Quand il reprend
-- délibérément une ligne existante, il rend son identifiant. Le serveur ne
-- rapproche plus rien : il lit l'identifiant, vérifie qu'il appartient bien à
-- cet artisan, et prend ce prix-là. Sinon, la ligne repart « à chiffrer ».
--
-- On échange une correspondance approximative et systématique contre une
-- correspondance exacte et volontaire. Il y aura moins de prix repris ; aucun
-- ne sera faux. Une case vide se voit, un prix faux non.
--
-- Le RÉFÉRENTIEL garde la ressemblance : ses libellés viennent des devis
-- réellement observés, non de ce que le modèle imagine, et son prix est une
-- médiane de métier, pas le tarif d'un homme.

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

  foreach m in array (
    case when p_metier is not null then array[p_metier] else v_metiers[1:8] end
  ) loop
    v_ref := v_ref || public.reference_metier(m, 60, v_id)::jsonb;
  end loop;

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

-- ---------- Le catalogue porte son identifiant ----------
--
-- `prix_artisan_by_token` renvoyait déjà `id` ; on s'assure qu'il est bien là,
-- puisque c'est désormais lui qui porte le prix jusqu'au devis.

create or replace function public.prix_artisan_by_token(p_token text)
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(json_agg(json_build_object(
           'id', p.id,
           'designation', p.designation,
           'unite', p.unite,
           'prix_unitaire', p.prix_unitaire,
           'cout_unitaire', p.cout_unitaire,
           'metier', p.metier,
           'utilisations', p.utilisations)
         order by p.utilisations desc, p.derniere_utilisation desc nulls last), '[]'::json)
    from public.devis_prix p
    join public.artisans a on a.id = p.artisan_id
   where a.token = p_token and a.ecarte_at is null;
$function$;

revoke execute on function public.prix_artisan_by_token(text) from public;
grant execute on function public.prix_artisan_by_token(text) to anon, authenticated;
