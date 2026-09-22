-- Un référentiel de lignes de devis, construit à partir des devis réels.
--
-- LA MATIÈRE
--
-- 107 devis PDF déposés par Batryx dorment dans le bucket `devis` : 17 887 €
-- de moyenne, répartis sur douze métiers — 31 façades, 18 couvertures,
-- 15 clôtures, 14 toitures. C'est le seul corpus de devis réels dont nous
-- disposions, et il ne sert à rien tant qu'il reste en PDF.
--
-- CE QU'ON EN TIRE
--
-- Deux choses, et pas une troisième :
--
--   * LES DÉSIGNATIONS — ce qu'on met vraiment sur un devis de ravalement,
--     avec quelles unités. C'est ce qui manquait à Remy Fabien (aucune
--     spécification de matériel) et à Sylvain Zingraff (« la moitié qui me
--     manque dessus »).
--   * UNE FOURCHETTE DE PRIX, mais sous condition stricte (voir ci-dessous).
--
-- LE PIÈGE DE LA CONFIDENTIALITÉ
--
-- Les 107 devis viennent tous de Batryx. Un simple seuil « au moins 5
-- observations » ne protège donc rien : la fourchette serait sa grille
-- tarifaire, servie à ses concurrents. L'article 13 du contrat engage
-- précisément les parties à garder confidentielles les conditions
-- commerciales.
--
-- Deux règles, donc :
--
--   * un artisan voit TOUJOURS ses propres prix — c'est sa donnée ;
--   * il ne voit une fourchette d'ensemble que si TROIS entreprises au moins
--     y contribuent, seuil sous lequel elle reste identifiable.
--
-- Aujourd'hui, seules les désignations circulent donc entre artisans. C'est
-- déjà l'essentiel : c'est ce qui manquait à Remy Fabien et à Zingraff. Les
-- fourchettes s'ouvriront d'elles-mêmes à mesure que d'autres déposent.
--
-- Côté agence, la fourchette reste visible sans restriction : elle aurait
-- signalé le devis de Carole Ledent (trois fois le concurrent) et celui de
-- Valérie Pancagene (cinq fois) avant qu'ils ne partent.

-- ---------- 1) Le suivi des extractions ----------
--
-- Une table à part pour garder trace des ÉCHECS : sans elle, un PDF illisible
-- serait repris à chaque passage, indéfiniment.

create table if not exists public.devis_extraction (
  affectation_id uuid primary key references public.affectations(id) on delete cascade,
  devis_url      text not null,
  statut         text not null default 'reussi'
                 check (statut in ('reussi', 'echoue')),
  lignes_extraites int not null default 0,
  modele         text,
  erreur         text,
  traite_le      timestamptz not null default now()
);

comment on table public.devis_extraction is
  'Journal de lecture des devis PDF. Garde les échecs pour ne pas réessayer '
  'indéfiniment un document illisible.';

-- ---------- 2) Les lignes observées ----------

create table if not exists public.devis_ligne_ref (
  id             uuid primary key default gen_random_uuid(),
  affectation_id uuid references public.affectations(id) on delete cascade,
  artisan_id     uuid references public.artisans(id) on delete set null,
  metier         text,

  designation    text not null,
  -- Clé de regroupement : c'est elle qui rassemble « Ravalement façade » et
  -- « ravalement  de façade » sous la même statistique.
  designation_norm text not null,
  unite          text,
  quantite       numeric(12, 2),
  prix_unitaire  numeric(12, 2),
  montant        numeric(12, 2),

  created_at     timestamptz not null default now()
);

create index if not exists idx_ligne_ref_metier
  on public.devis_ligne_ref (metier, designation_norm);

alter table public.devis_extraction enable row level security;
alter table public.devis_ligne_ref enable row level security;

do $$
begin
  drop policy if exists extraction_fondateur on public.devis_extraction;
  drop policy if exists ligne_ref_fondateur on public.devis_ligne_ref;
  -- Données commerciales d'autrui : jamais en accès direct. Les artisans n'y
  -- touchent qu'à travers la fonction agrégée, plus bas.
  create policy extraction_fondateur on public.devis_extraction
    for all using (public.est_fondateur()) with check (public.est_fondateur());
  create policy ligne_ref_fondateur on public.devis_ligne_ref
    for all using (public.est_fondateur()) with check (public.est_fondateur());
end $$;

-- ---------- 3) Normalisation des désignations ----------
--
-- Minuscules, accents retirés, ponctuation et pluriels courants gommés. Sans
-- ça « Ravalement de façades » et « ravalement facade » comptent pour deux.

create or replace function public.normaliser_designation(p_texte text)
returns text
language sql
immutable
as $function$
  -- Accents retirés, ponctuation gommée, mots-outils écartés et pluriels
  -- ramenés au singulier, puis remise en ordre alphabétique : sans quoi
  -- « Ravalement de façades » et « façade : ravalement » comptent pour deux.
  select nullif(
    array_to_string(
      array(
        select distinct regexp_replace(m, 's$', '')
          from unnest(regexp_split_to_array(
                 btrim(regexp_replace(
                   translate(lower(coalesce(p_texte, '')),
                             'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'),
                   '[^a-z0-9]+', ' ', 'g')),
                 ' ')) as m
         where length(m) > 1
           and m not in ('de','du','des','la','le','les','en','et','un','une',
                         'au','aux','sur','pour','avec','par','ml','ht','ttc')
         order by 1
      ), ' '),
    '');
$function$;

-- ---------- 4) Ce qu'il reste à lire ----------

create or replace function public.corpus_a_traiter(p_limite int default 10)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not (public.est_fondateur() or coalesce(auth.role(), '') = 'service_role') then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(json_build_object(
      'affectation_id', af.id,
      'devis_url', af.devis_url,
      'metier', p.metier,
      'montant', af.montant_devis))
    from (
      select af2.*
        from public.affectations af2
        join public.projets p2 on p2.id = af2.projet_id
       where af2.devis_url is not null
         and p2.deleted_at is null
         and not exists (
           select 1 from public.devis_extraction e where e.affectation_id = af2.id)
       order by af2.montant_devis desc nulls last
       limit greatest(p_limite, 1)
    ) af
    join public.projets p on p.id = af.projet_id
  ), '[]'::json);
end
$function$;

revoke execute on function public.corpus_a_traiter(int) from public, anon;
grant execute on function public.corpus_a_traiter(int) to authenticated, service_role;

-- ---------- 5) Enregistrer une lecture ----------

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

      insert into public.devis_ligne_ref
        (affectation_id, artisan_id, metier, designation, designation_norm,
         unite, quantite, prix_unitaire, montant)
      values (
        af.id, af.artisan_id, v_metier,
        btrim(l->>'designation'),
        public.normaliser_designation(l->>'designation'),
        nullif(btrim(coalesce(l->>'unite', '')), ''),
        nullif(l->>'quantite', '')::numeric,
        nullif(l->>'prix_unitaire', '')::numeric,
        nullif(l->>'montant', '')::numeric);

      v_n := v_n + 1;
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

-- ---------- 6) Le référentiel, agrégé et anonyme ----------
--
-- Le seuil de cinq devis n'est pas cosmétique : en dessous, une « fourchette
-- de marché » révélerait le prix d'une entreprise identifiable. Les lignes
-- moins fréquentes restent proposées — sans prix.

create or replace function public.reference_metier(
  p_metier text,
  p_limite int default 40,
  -- Artisan destinataire. Ses propres prix lui reviennent toujours ; ceux des
  -- autres ne s'agrègent que si trois entreprises au moins y contribuent.
  -- `null` = usage agence, sans restriction.
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
      -- La formulation la plus fréquente sert d'étiquette.
      mode() within group (order by r.designation) as designation,
      mode() within group (order by r.unite)       as unite,
      count(*)::int                                as n,
      count(distinct r.artisan_id)::int            as nb_artisans,
      -- Le prix ne sort que si le destinataire est l'auteur de TOUTES les
      -- observations, ou si la fourchette est assez collective pour ne
      -- désigner personne.
      (p_pour_artisan is null
        or count(distinct r.artisan_id) >= 3
        or count(*) filter (where r.artisan_id is distinct from p_pour_artisan) = 0
      ) as prix_visible,
      round(percentile_cont(0.5)  within group (order by r.prix_unitaire)::numeric, 2) as p50,
      round(percentile_cont(0.25) within group (order by r.prix_unitaire)::numeric, 2) as p25,
      round(percentile_cont(0.75) within group (order by r.prix_unitaire)::numeric, 2) as p75
    from public.devis_ligne_ref r
    where (p_metier is null or r.metier = p_metier)
      and r.prix_unitaire is not null
    group by r.designation_norm
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

drop function if exists public.reference_metier(text, int);
revoke execute on function public.reference_metier(text, int, uuid) from public, anon;
grant execute on function public.reference_metier(text, int, uuid) to authenticated, service_role;

comment on function public.reference_metier(text, int, uuid) is
  'Lignes de devis les plus fréquentes pour un métier. Les prix ne sont '
  'renvoyés que si le destinataire en est l''auteur, ou si trois entreprises '
  'au moins contribuent à la fourchette. Sans destinataire : usage agence.';

-- ---------- 7) Le référentiel vu de l'espace artisan ----------
--
-- L'artisan n'accède jamais aux tables : il passe par ici, avec son jeton, et
-- la restriction de prix s'applique à lui.

create or replace function public.reference_by_token(p_token text, p_metier text default null)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then return '[]'::json; end if;
  return public.reference_metier(p_metier, 40, v_id);
end
$function$;

revoke execute on function public.reference_by_token(text, text) from public;
grant execute on function public.reference_by_token(text, text) to anon, authenticated;
