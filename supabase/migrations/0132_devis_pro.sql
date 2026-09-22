-- Le devis passe du bloc-notes à l'outil de chiffrage.
--
-- CE QUI MANQUAIT
--
-- `devis` ne portait qu'un `total` : pas de TVA, pas de prix de revient, donc
-- ni marge ni conformité. Les appels d'Antoine ont montré ce que ça coûte —
-- « il a la moitié qui me manque dessus » (Zingraff), un devis à trois fois le
-- prix du concurrent (Ledent), à cinq fois (Pancagene). Un artisan qui ne voit
-- pas sa marge chiffre au doigt mouillé, et se fait sortir sur le prix.
--
-- CE QUE ÇA AJOUTE
--
--   * les trois totaux (HT, TVA, TTC), la TVA se réglant ligne par ligne —
--     un même chantier mêle souvent 10 % de rénovation et 20 % de neuf ;
--   * le DÉBOURSÉ par ligne, qui donne la marge ;
--   * une bibliothèque de prix propre à chaque artisan : il saisit une fois,
--     il réutilise ensuite.
--
-- SUR `total`
--
-- La colonne existante devient le TTC — c'est ce que paie le client, et c'est
-- l'assiette de la commission (article 5 du contrat). Les devis déjà en base
-- n'avaient pas de TVA : leur HT valait déjà leur TTC, leur `total` ne change
-- donc pas de valeur. Seul son nom se précise.

-- ---------- 1) Les totaux ----------

alter table public.devis
  add column if not exists total_ht  numeric(12, 2),
  add column if not exists total_tva numeric(12, 2),
  add column if not exists tva_mode  text;

comment on column public.devis.total is
  'Total TTC — ce que paie le client, et l''assiette de la commission.';
comment on column public.devis.tva_mode is
  'Régime retenu : normal, franchise (auto-entrepreneur), autoliquidation.';

-- Rattrapage : avant la TVA, le total valait le HT.
update public.devis
   set total_ht = total, total_tva = 0
 where total_ht is null;

-- ---------- 2) La bibliothèque de prix ----------
--
-- Propre à l'artisan, jamais partagée : ses prix sont son affaire, et un
-- référentiel commun deviendrait un barème que nous aurions à défendre.

create table if not exists public.devis_prix (
  id             uuid primary key default gen_random_uuid(),
  artisan_id     uuid not null references public.artisans(id) on delete cascade,

  designation    text not null,
  unite          text not null default 'u',
  prix_unitaire  numeric(12, 2) not null,
  -- Prix de revient. Facultatif : un artisan qui ne veut pas le saisir garde
  -- l'outil, il perd seulement l'affichage de sa marge.
  cout_unitaire  numeric(12, 2),
  metier         text,

  -- Sert au classement : les lignes les plus utilisées remontent en premier.
  utilisations   int not null default 1,
  derniere_utilisation timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Une même désignation dans la même unité n'existe qu'une fois : sinon la
-- bibliothèque se remplit de doublons au fil des devis.
create unique index if not exists idx_devis_prix_unique
  on public.devis_prix (artisan_id, lower(btrim(designation)), unite);

create index if not exists idx_devis_prix_artisan
  on public.devis_prix (artisan_id, utilisations desc);

alter table public.devis_prix enable row level security;

do $$
begin
  drop policy if exists devis_prix_fondateur on public.devis_prix;
  -- L'artisan y accède par ses RPC `security definer` (jeton d'espace) ; en
  -- accès direct, seul un fondateur lit — c'est une donnée commerciale.
  create policy devis_prix_fondateur on public.devis_prix
    for all using (public.est_fondateur()) with check (public.est_fondateur());
end $$;

-- ---------- 3) Lire et alimenter la bibliothèque ----------

create or replace function public.prix_artisan_by_token(p_token text)
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

  return coalesce((
    select json_agg(json_build_object(
      'id', x.id, 'designation', x.designation, 'unite', x.unite,
      'prix_unitaire', x.prix_unitaire, 'cout_unitaire', x.cout_unitaire,
      'metier', x.metier, 'utilisations', x.utilisations)
      order by x.utilisations desc, x.derniere_utilisation desc)
    from public.devis_prix x where x.artisan_id = v_id
  ), '[]'::json);
end
$function$;

revoke execute on function public.prix_artisan_by_token(text) from public;
grant execute on function public.prix_artisan_by_token(text) to anon, authenticated;

-- Appelée à l'enregistrement d'un devis, pour chaque ligne saisie : la
-- bibliothèque se construit toute seule à l'usage, sans écran de gestion.
create or replace function public.enregistrer_prix_by_token(
  p_token text,
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
  l jsonb;
  v_n int := 0;
begin
  select id into v_id from public.artisans where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb))
  loop
    continue when coalesce(btrim(l->>'designation'), '') = '';
    continue when coalesce((l->>'prix_unitaire')::numeric, 0) <= 0;

    insert into public.devis_prix
      (artisan_id, designation, unite, prix_unitaire, cout_unitaire, metier)
    values (
      v_id, btrim(l->>'designation'), coalesce(nullif(l->>'unite',''), 'u'),
      (l->>'prix_unitaire')::numeric,
      nullif(l->>'cout_unitaire','')::numeric,
      nullif(btrim(coalesce(p_metier, '')), '')
    )
    on conflict (artisan_id, lower(btrim(designation)), unite) do update
      -- Le dernier prix pratiqué fait foi : c'est celui que l'artisan vient de
      -- retenir face à un client.
      set prix_unitaire = excluded.prix_unitaire,
          cout_unitaire = coalesce(excluded.cout_unitaire, public.devis_prix.cout_unitaire),
          metier = coalesce(excluded.metier, public.devis_prix.metier),
          utilisations = public.devis_prix.utilisations + 1,
          derniere_utilisation = now();

    v_n := v_n + 1;
  end loop;

  return json_build_object('ok', true, 'enregistrees', v_n);
end
$function$;

revoke execute on function public.enregistrer_prix_by_token(text, jsonb, text) from public;
grant execute on function public.enregistrer_prix_by_token(text, jsonb, text) to anon, authenticated;

-- ---------- 4) Qui a le droit de faire un devis ----------
--
-- `_devis_artisan` était verrouillée sur un identifiant en dur, comme l'écran :
--
--     select * from public.artisans
--      where token = p_token and id = '98a39398-…'::uuid;
--
-- Elle redevient ce que son nom dit : l'artisan qui détient ce jeton. Le verrou
-- ne disparaît pas, il se déplace là où il a du sens — sur la CRÉATION.
--
-- La distinction compte : un artisan dont la décennale vient d'expirer ne doit
-- plus établir de nouveau devis, mais il doit continuer à relire et rééditer
-- ceux qu'il a déjà faits. Verrouiller la lecture lui retirerait ses propres
-- documents pour une date d'échéance.

create or replace function public._devis_artisan(p_token text)
returns public.artisans
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select * from public.artisans
   where token = p_token and ecarte_at is null;
$function$;

-- Condition unique du chiffrage, partagée par l'écran et la création : deux
-- expressions séparées finiraient par diverger.
create or replace function public.peut_chiffrer(p_artisan_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.artisans a
     where a.id = p_artisan_id
       and a.assurances_validees_at is not null
       and coalesce(a.assurance_decennale_echeance, 'infinity'::date) >= current_date
       and coalesce(a.assurance_rc_pro_echeance,    'infinity'::date) >= current_date
  );
$function$;

revoke execute on function public.peut_chiffrer(uuid) from public, anon;
grant execute on function public.peut_chiffrer(uuid) to authenticated;

-- ---------- 5) La création de devis enregistre les trois totaux ----------
--
-- Réécrite à l'identique, à l'exception du bloc `insert` : on ne touche ni au
-- rattachement explicite par jeton d'affectation, ni au rattachement
-- automatique par téléphone puis par nom, qui fonctionnent.

create or replace function public.creer_devis_by_token(p_token text, p_payload jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a public.artisans;
  af public.affectations;
  v_num text;
  v_id uuid;
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false, 'error', 'non autorisé'); end if;

  -- Le chiffrage s'ouvre avec les assurances (0131), et se referme tout seul
  -- quand elles expirent. Contrôlé ici, pas seulement à l'écran : un appel
  -- direct à l'API doit être refusé de la même façon.
  if not public.peut_chiffrer(a.id) then
    return json_build_object('ok', false, 'error', 'chiffrage_non_active');
  end if;

  if coalesce(p_payload->>'affectation_token','') <> '' then
    select * into af from public.affectations
     where token = p_payload->>'affectation_token' and artisan_id = a.id;
  end if;

  if af.id is null then
    select af3.* into af
      from public.affectations af3
      join public.projets p3 on p3.id = af3.projet_id
     where af3.artisan_id = a.id
       and af3.statut <> 'perdu'
       and p3.deleted_at is null
       and (
         (nullif(regexp_replace(coalesce(p_payload->>'client_tel',''), '\D', '', 'g'), '') is not null
           and regexp_replace(coalesce(p3.client_telephone,''), '\D', '', 'g')
               = regexp_replace(p_payload->>'client_tel', '\D', '', 'g'))
         or (nullif(trim(p_payload->>'client_nom'), '') is not null
           and lower(trim(p3.client_nom)) = lower(trim(p_payload->>'client_nom')))
       )
     order by af3.created_at desc
     limit 1;
  end if;

  v_num := 'DEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.devis_seq')::text, 4, '0');

  -- Les totaux sont recalculés ici plutôt que crus sur parole : le client
  -- pourrait envoyer n'importe quoi, et c'est ce chiffre qui porte la
  -- commission.
  select
    coalesce(sum((l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric), 0),
    coalesce(sum((l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric
                 * coalesce((l->>'tva_taux')::numeric, 0) / 100), 0)
    into v_ht, v_tva
    from jsonb_array_elements(coalesce(p_payload->'lignes','[]'::jsonb)) l;
  v_ttc := round(v_ht + v_tva, 2);

  insert into public.devis (
    artisan_id, projet_id, affectation_id, numero,
    client_nom, client_adresse, client_cp, client_ville, client_email, client_tel,
    objet, lignes, total, total_ht, total_tva, tva_mode,
    acompte_pct, conditions, notes, date_validite
  ) values (
    a.id, af.projet_id, af.id, v_num,
    p_payload->>'client_nom', p_payload->>'client_adresse', p_payload->>'client_cp',
    p_payload->>'client_ville', p_payload->>'client_email', p_payload->>'client_tel',
    p_payload->>'objet', coalesce(p_payload->'lignes','[]'::jsonb),
    v_ttc, round(v_ht, 2), round(v_tva, 2),
    nullif(p_payload->>'tva_mode',''),
    nullif(p_payload->>'acompte_pct','')::numeric,
    p_payload->>'conditions', p_payload->>'notes',
    nullif(p_payload->>'date_validite','')::date
  ) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'numero', v_num,
                           'projet_id', af.projet_id,
                           'total_ht', round(v_ht, 2), 'total_ttc', v_ttc);
end
$function$;

revoke execute on function public.creer_devis_by_token(text, jsonb) from public;
grant execute on function public.creer_devis_by_token(text, jsonb) to anon, authenticated;

-- ---------- 6) Ce dont le chiffrage a besoin pour s'afficher ----------
--
-- Le taux de commission et l'assurance rejoignent l'état du chiffrage : le
-- premier pour montrer à l'artisan ce qui lui restera, la seconde pour la
-- mention obligatoire en pied de devis. Les faire transiter ici évite de
-- toucher à `get_espace_artisan`, qui construit déjà un JSON immense.

create or replace function public.etat_chiffrage_by_token(p_token text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  a public.artisans;
  v_ok boolean;
begin
  select * into a from public.artisans where token = p_token and ecarte_at is null;
  if a.id is null then return null; end if;

  v_ok := public.peut_chiffrer(a.id);

  return json_build_object(
    'peut_chiffrer', v_ok,
    'validees_le', a.assurances_validees_at,
    'taux_commission', a.taux_commission,
    'decennale', json_build_object(
      'deposee',  coalesce(a.assurance_decennale_url, '') <> '',
      'assureur', a.assurance_decennale_assureur,
      'police',   a.assurance_decennale_police,
      'echeance', a.assurance_decennale_echeance,
      'expiree',  a.assurance_decennale_echeance is not null
                  and a.assurance_decennale_echeance < current_date),
    'rc_pro', json_build_object(
      'deposee',  coalesce(a.assurance_rc_pro_url, '') <> '',
      'assureur', a.assurance_rc_pro_assureur,
      'police',   a.assurance_rc_pro_police,
      'echeance', a.assurance_rc_pro_echeance,
      'expiree',  a.assurance_rc_pro_echeance is not null
                  and a.assurance_rc_pro_echeance < current_date)
  );
end
$function$;

revoke execute on function public.etat_chiffrage_by_token(text) from public;
grant execute on function public.etat_chiffrage_by_token(text) to anon, authenticated;
