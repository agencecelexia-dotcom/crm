-- Le devis type doit se lire dans l'ordre des travaux.
--
-- LE DÉFAUT
--
-- 0136 classe les ouvrages par fréquence. Le devis type « Façade » commençait
-- donc par « Nettoyage de fin de chantier » (18 observations) et finissait par
-- l'échafaudage (15). Aucun artisan ne présente un devis ainsi : un devis se
-- lit comme le chantier se déroule — protection, nettoyage, piquage, gobetis,
-- enduit, finitions, nettoyage final.
--
-- Un modèle qu'il faut réordonner à la main n'a rien fait gagner.
--
-- RETROUVER L'ORDRE SANS RELIRE LES PDF
--
-- La position de chaque ligne n'a pas été enregistrée à l'extraction. Mais
-- `devis_ligne_ref` n'a jamais subi ni `update` ni `delete` : elle n'a reçu que
-- des insertions, faites ligne à ligne dans l'ordre du document. Son ordre
-- PHYSIQUE (`ctid`) est donc encore l'ordre du devis d'origine.
--
-- Vérifié sur deux devis de façade avant d'y toucher :
--
--   Protection des menuiseries → Nettoyage haute pression → Purge des zones
--   fissurées → Gobetis → Enduit traditionnel → Raccords → Hydrofuge →
--   Nettoyage de fin de chantier
--
-- L'ordre est intact. On le fige dans une colonne pendant qu'il l'est encore :
-- `ctid` ne survivrait pas à un VACUUM FULL.
--
-- Relire les 109 PDF aurait donné le même résultat pour une centaine d'appels
-- au modèle.

alter table public.devis_ligne_ref
  add column if not exists position int;

comment on column public.devis_ligne_ref.position is
  'Rang de la ligne dans son devis d''origine, à partir de 1. Sert à présenter '
  'le devis type dans l''ordre des travaux plutôt que par fréquence.';

update public.devis_ligne_ref r
   set position = s.rn
  from (select id, row_number() over (partition by affectation_id order by ctid) rn
          from public.devis_ligne_ref) s
 where s.id = r.id
   and r.position is null;

-- ---------- Les extractions à venir la portent d'elles-mêmes ----------

create or replace function public.enregistrer_extraction(
  p_affectation_id uuid,
  p_lignes jsonb,
  p_modele text default null,
  p_erreur text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  af public.affectations;
  v_metier text;
  v_n int := 0;
  l jsonb;
begin
  if not (public.est_fondateur() or coalesce(auth.role(), '') = 'service_role') then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  select * into af from public.affectations where id = p_affectation_id;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;
  select metier into v_metier from public.projets where id = af.projet_id;

  -- Relecture d'un devis déjà traité : on repart de zéro plutôt que d'empiler
  -- deux fois les mêmes lignes.
  delete from public.devis_ligne_ref where affectation_id = p_affectation_id;

  if p_erreur is null then
    for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb))
    loop
      continue when public.normaliser_designation(l->>'designation') is null;

      v_n := v_n + 1;

      insert into public.devis_ligne_ref
        (affectation_id, artisan_id, metier, designation, designation_norm,
         unite, quantite, prix_unitaire, montant, position)
      values (
        af.id, af.artisan_id, v_metier,
        btrim(l->>'designation'),
        public.normaliser_designation(l->>'designation'),
        nullif(btrim(coalesce(l->>'unite', '')), ''),
        nullif(l->>'quantite', '')::numeric,
        nullif(l->>'prix_unitaire', '')::numeric,
        nullif(l->>'montant', '')::numeric,
        v_n);
    end loop;
  end if;

  insert into public.devis_extraction
    (affectation_id, devis_url, statut, lignes_extraites, modele, erreur)
  values (af.id, af.devis_url,
          case when p_erreur is null then 'reussi' else 'echoue' end,
          v_n, p_modele, p_erreur)
  on conflict (affectation_id) do update
    set statut = excluded.statut,
        lignes_extraites = excluded.lignes_extraites,
        modele = excluded.modele,
        erreur = excluded.erreur,
        traite_le = now();

  return json_build_object('ok', true, 'lignes', v_n);
end
$function$;

revoke execute on function public.enregistrer_extraction(uuid, jsonb, text, text) from public, anon;
grant execute on function public.enregistrer_extraction(uuid, jsonb, text, text) to authenticated, service_role;

-- ---------- Les unités, ramenées à celles du générateur ----------
--
-- Le corpus écrit « m2 » 268 fois et « m² » une seule ; il connaît aussi
-- « jour » et « sem ». Le générateur, lui, propose une liste fermée. Une unité
-- hors liste produit un sélecteur vide dans le devis, et la cote commune ne
-- reconnaît plus ses lignes au m².
--
-- Les unités inconnues tombent sur « u », avec une quantité de 1 : c'est le
-- défaut le moins trompeur — l'artisan corrige, il ne découvre pas une
-- quantité fausse après coup.

create or replace function public.normaliser_unite(p_unite text)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $function$
  select case lower(btrim(coalesce(p_unite, '')))
    when 'm2' then 'm²'  when 'm²' then 'm²'  when 'm2.' then 'm²'
    when 'm3' then 'm³'  when 'm³' then 'm³'
    when 'ml' then 'ml'  when 'mlt' then 'ml' when 'mètre linéaire' then 'ml'
    when 'forfait' then 'forfait' when 'ft' then 'forfait' when 'fft' then 'forfait'
    when 'ens' then 'ens.' when 'ens.' then 'ens.' when 'ensemble' then 'ens.'
    when 'h' then 'h'    when 'heure' then 'h'  when 'heures' then 'h'
    when 'j' then 'j'    when 'jour' then 'j'   when 'jours' then 'j'
    else 'u'
  end;
$function$;

revoke execute on function public.normaliser_unite(text) from public;

-- ---------- Le rang moyen, ajouté à la référence ----------
--
-- La position brute ne se compare pas d'un devis à l'autre : être 7e sur 8 et
-- 7e sur 20 ne dit pas la même chose. On rapporte donc la position au nombre
-- de lignes du devis, et on prend la médiane de ce rapport sur la famille.
--
-- `reference_metier` reste triée par fréquence — c'est le bon ordre pour une
-- bibliothèque, où l'on cherche d'abord ce qu'on facture le plus souvent. Le
-- `rang` est simplement fourni, à charge de celui qui présente un MODÈLE de
-- s'en servir.

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
      mode() within group (order by r.designation) as designation,
      mode() within group (order by public.normaliser_unite(r.unite)) as unite,
      count(*)::int                                as n,
      count(distinct r.artisan_id)::int            as nb_artisans,
      (p_pour_artisan is null
        or count(distinct r.artisan_id) >= 3
        or count(*) filter (where r.artisan_id is distinct from p_pour_artisan) = 0
      ) as prix_visible,
      round(percentile_cont(0.5)  within group (order by r.prix_unitaire)::numeric, 2) as p50,
      round(percentile_cont(0.25) within group (order by r.prix_unitaire)::numeric, 2) as p25,
      round(percentile_cont(0.75) within group (order by r.prix_unitaire)::numeric, 2) as p75,
      round(percentile_cont(0.5) within group (
        order by r.position::numeric / nullif(c.n, 0))::numeric, 4)                     as rang
    from public.devis_ligne_ref r
    join public.grouper_ouvrages(p_metier) g on g.norme = r.designation_norm
    join (select affectation_id, count(*) n
            from public.devis_ligne_ref group by affectation_id) c
      on c.affectation_id = r.affectation_id
    where (p_metier is null or r.metier = p_metier)
      and r.prix_unitaire is not null
    group by g.tete
    order by count(*) desc
    limit greatest(p_limite, 1)
  ) x0,
  lateral (
    select x0.designation, x0.unite, x0.n, x0.nb_artisans, x0.rang,
           case when x0.prix_visible then x0.p50 end as prix_median,
           case when x0.prix_visible then x0.p25 end as prix_bas,
           case when x0.prix_visible then x0.p75 end as prix_haut
  ) x;
$function$;

revoke execute on function public.reference_metier(text, int, uuid) from public;
grant execute on function public.reference_metier(text, int, uuid) to authenticated;

-- ---------- Le modèle, lui, se présente dans l'ordre des travaux ----------

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

  -- Les huit ouvrages les plus fréquents du métier, RANGÉS DANS L'ORDRE DES
  -- TRAVAUX. Les prix ne sont repris que lorsque la règle de confidentialité
  -- (0133) les rend visibles à cet artisan ; sinon la ligne arrive sans prix.
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
          'unite', coalesce(r->>'unite', 'u'),
          'quantite', 1,
          'prix_unitaire', r->'prix_median',
          'cout_unitaire', null)
          order by coalesce((r->>'rang')::numeric, 1), (r->>'designation'))))
    end
      into v_type
      from json_array_elements(public.reference_metier(p_metier, 8, v_id)) r;
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
