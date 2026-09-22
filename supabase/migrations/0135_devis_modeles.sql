-- Ne plus jamais partir d'une page blanche.
--
-- CE QUE FAIT LE MARCHÉ
--
-- Tolteck, Obat, Batappli vendent tous la même chose : une BIBLIOTHÈQUE
-- D'OUVRAGES. Un ouvrage est une prestation vendue au client, composée
-- d'éléments (fournitures, main-d'œuvre, location). L'artisan ne saisit pas,
-- il pioche.
--
-- CE QU'ON FAIT, ET CE QU'ON NE FAIT PAS
--
-- On s'arrête au déboursé sec par ligne, sans décomposer main-d'œuvre et
-- fournitures. Cette décomposition est la force de Batappli et sa lourdeur :
-- elle demande à l'artisan de tenir un référentiel de temps unitaires. Notre
-- objectif est inverse — qu'un devis se fasse en trois minutes sur un
-- téléphone, au bord du chantier.
--
-- En revanche on ajoute ce qui fait vraiment gagner du temps : le MODÈLE. Un
-- clic, et le devis est déjà écrit à 80 %.
--
-- Trois sources de modèles :
--
--   1. ceux que l'artisan enregistre depuis un devis qu'il vient de faire ;
--   2. le DEVIS TYPE du métier, déduit des devis réellement observés (0133) —
--      c'est ce qu'aucun concurrent ne peut proposer, puisque personne
--      d'autre ne dispose du corpus ;
--   3. la duplication d'un devis précédent, le geste le plus fréquent quand
--      deux chantiers se ressemblent.

-- ---------- 1) Les modèles de l'artisan ----------

create table if not exists public.devis_modele (
  id           uuid primary key default gen_random_uuid(),
  artisan_id   uuid not null references public.artisans(id) on delete cascade,
  nom          text not null,
  metier       text,
  -- Mêmes clés qu'une ligne de devis : designation, unite, quantite,
  -- prix_unitaire, cout_unitaire. Stockées telles quelles pour que le
  -- générateur les reprenne sans traduction.
  lignes       jsonb not null default '[]'::jsonb,
  utilisations int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_devis_modele_artisan
  on public.devis_modele (artisan_id, utilisations desc);

alter table public.devis_modele enable row level security;

do $$
begin
  drop policy if exists devis_modele_fondateur on public.devis_modele;
  create policy devis_modele_fondateur on public.devis_modele
    for all using (public.est_fondateur()) with check (public.est_fondateur());
end $$;

-- ---------- 2) Lire les modèles disponibles ----------
--
-- Les siens d'abord, puis le devis type du métier. Ce dernier est CALCULÉ à
-- la volée depuis le référentiel : il s'améliore à chaque devis lu, sans
-- qu'on ait à le maintenir.

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

  -- Devis type du métier : les huit lignes les plus fréquentes du
  -- référentiel, dans l'ordre de fréquence. Les prix ne sont repris que
  -- lorsque la règle de confidentialité (0133) les rend visibles à cet
  -- artisan ; sinon la ligne arrive sans prix, à compléter.
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
          'cout_unitaire', null))))
    end
      into v_type
      from (
        select r from json_array_elements(public.reference_metier(p_metier, 8, v_id)) r
      ) s;
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

-- ---------- 3) Enregistrer un modèle ----------

create or replace function public.enregistrer_modele_by_token(
  p_token text,
  p_nom text,
  p_lignes jsonb,
  p_metier text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_modele uuid;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  if coalesce(btrim(p_nom), '') = '' then
    return json_build_object('ok', false, 'error', 'nom_requis');
  end if;
  if coalesce(jsonb_array_length(p_lignes), 0) = 0 then
    return json_build_object('ok', false, 'error', 'aucune_ligne');
  end if;

  -- Deux modèles du même nom prêtent à confusion : le second écrase le
  -- premier, ce qui est aussi la façon la plus simple d'en corriger un.
  delete from public.devis_modele
   where artisan_id = v_id and lower(btrim(nom)) = lower(btrim(p_nom));

  insert into public.devis_modele (artisan_id, nom, metier, lignes)
  values (v_id, btrim(p_nom), nullif(btrim(coalesce(p_metier, '')), ''), p_lignes)
  returning id into v_modele;

  return json_build_object('ok', true, 'id', v_modele);
end
$function$;

revoke execute on function public.enregistrer_modele_by_token(text, text, jsonb, text) from public;
grant execute on function public.enregistrer_modele_by_token(text, text, jsonb, text) to anon, authenticated;

create or replace function public.supprimer_modele_by_token(p_token text, p_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  delete from public.devis_modele where id = p_id and artisan_id = v_id;
  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.supprimer_modele_by_token(text, uuid) from public;
grant execute on function public.supprimer_modele_by_token(text, uuid) to anon, authenticated;

-- ---------- 4) Repartir d'un devis déjà fait ----------
--
-- Le geste le plus fréquent : deux chantiers se ressemblent, on reprend le
-- précédent et on ajuste. Les lignes seulement — le client, lui, est celui du
-- nouveau chantier.

create or replace function public.dupliquer_devis_by_token(p_token text, p_devis_id uuid)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  d public.devis;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  select * into d from public.devis where id = p_devis_id and artisan_id = v_id;
  if d.id is null then
    return json_build_object('ok', false, 'error', 'devis_introuvable');
  end if;

  return json_build_object('ok', true, 'objet', d.objet, 'lignes', d.lignes,
                           'tva_mode', d.tva_mode, 'conditions', d.conditions);
end
$function$;

revoke execute on function public.dupliquer_devis_by_token(text, uuid) from public;
grant execute on function public.dupliquer_devis_by_token(text, uuid) to anon, authenticated;
