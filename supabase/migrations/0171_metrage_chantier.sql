-- Le dossier de métrés du chantier : ce que dit le client, ce que mesure
-- l'outil, ce qu'on retient.
--
-- POURQUOI
--
-- Au téléphone, le client dit « ma clôture fait dix mètres ». Cette phrase
-- finissait en texte libre dans une note, jamais vérifiée, jamais retrouvée
-- par l'artisan. De son côté l'outil mesure le toit au LiDAR, sans que
-- personne ne rapproche les deux chiffres.
--
-- Ici, une ligne par chantier et par quantité (catalogue-metrage.ts) :
--
--   déclaré   ce qu'a dit le client, ou noté l'agence, avec la phrase exacte ;
--   mesuré    ce qu'a mesuré l'outil, et d'où ;
--   retenu    ce que l'artisan doit lire, et qui l'a décidé.
--
-- LE STATUT, TEL QUE L'ÉCRAN LE MONTRE
--
--   mesure             mesuré seulement                  « mesuré »
--   declare            dit seulement                      « dit par le client »
--   coherent           dit et mesuré concordent          « ✓ vérifié »  (on retient la mesure)
--   ecart              dit et mesuré divergent           « à vérifier » (rien n'est retenu)
--   sources_desaccord  deux mesures divergent            « à vérifier » (posé par le calcul)
--   confirme           un humain a tranché               « ✓ confirmé »
--
-- Les tolérances dépendent de l'unité — la même règle que
-- `concorde()` dans catalogue-metrage.ts : un client arrondit, mais au-delà
-- c'est un malentendu (autre façade, autre côté du terrain).
--
-- Une décision humaine ne se défait jamais par un calcul.

create table if not exists public.metrage_chantier (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets(id) on delete cascade,
  cle text not null check (cle ~ '^[a-z_]{2,40}$'),
  unite text not null check (unite in ('m2', 'ml', 'm', 'pct', 'u', 'oui_non')),

  valeur_declaree numeric check (valeur_declaree is null or valeur_declaree between 0 and 100000),
  declaree_par text check (declaree_par in ('client', 'agence', 'artisan')),
  declaree_source text check (declaree_source in ('appel', 'saisie', 'visite')),
  citation text check (citation is null or length(citation) <= 500),
  declaree_le timestamptz,

  valeur_mesuree numeric check (valeur_mesuree is null or valeur_mesuree between 0 and 100000),
  mesure_source text check (mesure_source in ('lidar', 'google', 'photogrammetrie', 'parcelle', 'dessin', 'ia_photo')),
  mesure_precision numeric,
  mesure_detail jsonb,
  mesuree_le timestamptz,

  statut text not null default 'mesure'
    check (statut in ('mesure', 'declare', 'coherent', 'ecart', 'sources_desaccord', 'confirme')),

  valeur_retenue numeric check (valeur_retenue is null or valeur_retenue between 0 and 100000),
  retenue_par text check (retenue_par in ('outil', 'agence', 'artisan')),
  retenue_le timestamptz,
  note text check (note is null or length(note) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (projet_id, cle)
);

-- La file « Métrés à vérifier » de l'agence ne lit que ces deux statuts.
create index if not exists metrage_chantier_a_verifier
  on public.metrage_chantier (projet_id) where statut in ('ecart', 'sources_desaccord');

-- ---------- La règle de concordance ----------

create or replace function public.metrage_concorde(p_unite text, p_declaree numeric, p_mesuree numeric)
returns boolean
language sql
immutable
set search_path to 'pg_temp'
as $function$
  select case p_unite
    when 'm2'  then p_mesuree > 0 and abs(p_declaree - p_mesuree) / p_mesuree <= 0.12
    when 'ml'  then p_mesuree > 0 and abs(p_declaree - p_mesuree) / p_mesuree <= 0.10
    when 'm'   then abs(p_declaree - p_mesuree) <= 0.5
    when 'pct' then abs(p_declaree - p_mesuree) <= 5
    else p_declaree = p_mesuree
  end
$function$;

-- ---------- Le statut se déduit, sauf décision humaine ----------

create or replace function public.metrage_verifier()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.updated_at := now();

  -- Un humain a tranché : rien ne se recalcule par-dessus.
  if new.statut = 'confirme' then
    if new.valeur_retenue is null or new.retenue_par not in ('agence', 'artisan') then
      raise exception 'Une confirmation porte une valeur et son auteur (agence ou artisan).';
    end if;
    new.retenue_le := coalesce(new.retenue_le, now());
    return new;
  end if;

  -- Deux mesures en désaccord : posé par le calcul, levé par un humain ou
  -- par un nouveau calcul qui repasse le statut à « mesure ».
  if new.statut = 'sources_desaccord' then
    new.valeur_retenue := null;
    new.retenue_par := null;
    return new;
  end if;

  if new.valeur_declaree is not null and new.valeur_mesuree is not null then
    if public.metrage_concorde(new.unite, new.valeur_declaree, new.valeur_mesuree) then
      new.statut := 'coherent';
      new.valeur_retenue := new.valeur_mesuree;
      new.retenue_par := 'outil';
    else
      new.statut := 'ecart';
      new.valeur_retenue := null;
      new.retenue_par := null;
    end if;
  elsif new.valeur_mesuree is not null then
    new.statut := 'mesure';
    new.valeur_retenue := new.valeur_mesuree;
    new.retenue_par := 'outil';
  elsif new.valeur_declaree is not null then
    new.statut := 'declare';
    new.valeur_retenue := new.valeur_declaree;
    new.retenue_par := 'outil';
  else
    new.statut := 'mesure';
    new.valeur_retenue := null;
    new.retenue_par := null;
  end if;
  new.retenue_le := case when new.valeur_retenue is null then null else now() end;
  return new;
end
$function$;

drop trigger if exists metrage_verifier on public.metrage_chantier;
create trigger metrage_verifier
  before insert or update on public.metrage_chantier
  for each row execute function public.metrage_verifier();

-- ---------- Droits : l'agence par ses projets, l'artisan par son jeton ----------

alter table public.metrage_chantier enable row level security;

drop policy if exists metrage_par_projet on public.metrage_chantier;
create policy metrage_par_projet on public.metrage_chantier
  for all to authenticated
  using (projet_id in (select public.mes_projets()))
  with check (projet_id in (select public.mes_projets()));

revoke all on public.metrage_chantier from anon;
grant select, insert, update, delete on public.metrage_chantier to authenticated;

-- L'artisan lit le dossier de SON chantier.
create or replace function public.metrage_by_token(p_token text, p_affectation_token text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
  v_signe boolean;
begin
  select id into v_artisan from public.artisans where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  select * into af from public.affectations where token = p_affectation_token;
  if af.id is null or af.artisan_id <> v_artisan then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;
  -- La phrase du client suit la règle de son adresse : lisible une fois le
  -- contrat signé.
  v_signe := exists (select 1 from public.contrats c where c.artisan_id = v_artisan and c.signed_at is not null);

  return json_build_object('ok', true, 'metrage', (
    select coalesce(json_agg(json_build_object(
             'cle', m.cle, 'unite', m.unite,
             'valeur_declaree', m.valeur_declaree, 'declaree_par', m.declaree_par,
             'citation', case when v_signe then m.citation end,
             'valeur_mesuree', m.valeur_mesuree, 'mesure_source', m.mesure_source,
             'mesure_detail', m.mesure_detail,
             'statut', m.statut, 'valeur_retenue', m.valeur_retenue,
             'retenue_par', m.retenue_par, 'note', m.note)
           order by m.cle), '[]'::json)
      from public.metrage_chantier m
     where m.projet_id = af.projet_id));
end
$function$;

-- « Mesuré sur place » : l'artisan a vu le chantier, sa valeur devient celle
-- qu'on retient.
create or replace function public.corriger_metrage_by_token(
  p_token text, p_affectation_token text, p_cle text, p_unite text, p_valeur numeric, p_note text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
  v_unite text;
begin
  if public.acces_par_jeton(p_affectation_token, true) is not null then
    return json_build_object('ok', false, 'error', public.acces_par_jeton(p_affectation_token, true));
  end if;
  select id into v_artisan from public.artisans where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  select * into af from public.affectations where token = p_affectation_token;
  if af.id is null or af.artisan_id <> v_artisan then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;
  if p_cle is null or p_cle !~ '^[a-z_]{2,40}$'
     or p_unite is null or p_unite not in ('m2', 'ml', 'm', 'pct', 'u', 'oui_non') then
    return json_build_object('ok', false, 'error', 'quantite_invalide');
  end if;
  if p_valeur is null or p_valeur < 0 or p_valeur > 100000 then
    return json_build_object('ok', false, 'error', 'valeur_invalide');
  end if;
  select unite into v_unite from public.metrage_chantier where projet_id = af.projet_id and cle = p_cle;
  if v_unite is not null and v_unite <> p_unite then
    return json_build_object('ok', false, 'error', 'quantite_invalide');
  end if;

  insert into public.metrage_chantier (projet_id, cle, unite, statut, valeur_retenue, retenue_par, retenue_le, note)
  values (af.projet_id, p_cle, p_unite, 'confirme', p_valeur, 'artisan', now(),
          coalesce(nullif(left(trim(p_note), 500), ''), 'Mesuré sur place'))
  on conflict (projet_id, cle) do update
     set statut = 'confirme', valeur_retenue = excluded.valeur_retenue, retenue_par = 'artisan',
         retenue_le = now(), note = excluded.note;
  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.metrage_by_token(text, text) from public;
revoke execute on function public.corriger_metrage_by_token(text, text, text, text, numeric, text) from public;
grant execute on function public.metrage_by_token(text, text) to anon, authenticated;
grant execute on function public.corriger_metrage_by_token(text, text, text, text, numeric, text) to anon, authenticated;
