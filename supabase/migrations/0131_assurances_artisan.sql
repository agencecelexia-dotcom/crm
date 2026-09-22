-- Le coffre à assurances, et le déblocage du chiffrage.
--
-- LE PROBLÈME
--
-- `artisans` ne portait que deux booléens DÉCLARATIFS — `assurance_rc_pro` et
-- `assurance_decennale` — cochés à la main, sans pièce ni date. 46 artisans sur
-- 100 déclarent une décennale : personne n'a jamais vu l'attestation, et rien
-- ne dit si elle est encore valable.
--
-- L'article 10 du contrat impose pourtant à l'artisan d'en justifier à première
-- demande et de maintenir ses garanties pendant toute la durée du contrat.
-- L'obligation existait, l'outil non.
--
-- CE QUE ÇA DÉBLOQUE
--
-- Le générateur de devis n'est aujourd'hui visible que par un seul artisan
-- (`isMetbach`, en dur dans l'écran). Ce classement en dur laisse la place à
-- une condition qui a du sens : on ne chiffre pas au nom de Celexia sans avoir
-- montré patte blanche.
--
-- LE CHEMIN DE STOCKAGE
--
-- Les attestations vont dans le bucket privé `documents`, sous
-- `assurances/<jeton artisan>/<type>.<ext>`. Le premier segment fixe l'usage,
-- le second autorise le dépôt — exactement le motif de `devis_insert_token`.

-- ---------- 1) Les colonnes ----------

alter table public.artisans
  add column if not exists assurance_decennale_url       text,
  add column if not exists assurance_decennale_assureur  text,
  add column if not exists assurance_decennale_police    text,
  add column if not exists assurance_decennale_echeance  date,
  add column if not exists assurance_rc_pro_url          text,
  add column if not exists assurance_rc_pro_assureur     text,
  add column if not exists assurance_rc_pro_police       text,
  add column if not exists assurance_rc_pro_echeance     date,
  add column if not exists assurances_validees_at        timestamptz,
  add column if not exists assurances_validees_par       uuid references auth.users(id) on delete set null;

comment on column public.artisans.assurances_validees_at is
  'Validation par un fondateur des deux attestations déposées. Tant qu''elle '
  'est nulle, l''artisan n''a pas accès au générateur de devis.';

-- ---------- 2) Qui a le droit de déposer ----------
--
-- Jumelle de `token_affectation_valide` (0058), côté artisan : elle autorise
-- l'écriture dans le stockage à celui qui détient le jeton de son espace.

create or replace function public.token_artisan_valide(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.artisans a
     where a.token = p_token
       and a.ecarte_at is null
  );
$function$;

revoke execute on function public.token_artisan_valide(text) from public;
grant execute on function public.token_artisan_valide(text) to anon, authenticated;

do $$
begin
  drop policy if exists documents_assurance_token on storage.objects;

  -- Dépôt limité au préfixe `assurances/<son propre jeton>/` : un artisan ne
  -- peut rien écrire ailleurs dans le bucket, ni sous le jeton d'un autre.
  create policy documents_assurance_token on storage.objects
    for insert to anon
    with check (
      bucket_id = 'documents'
      and split_part(name, '/', 1) = 'assurances'
      and public.token_artisan_valide(split_part(name, '/', 2))
    );
end $$;

-- ---------- 3) L'artisan déclare sa pièce ----------
--
-- Le fichier est déjà dans le stockage quand cette fonction est appelée : elle
-- ne fait qu'enregistrer où il est et ce qu'il contient. Les métadonnées
-- viennent de la lecture par Claude (edge function `assurance-lire`), que
-- l'artisan peut corriger avant d'envoyer.
--
-- Tout dépôt REMET À ZÉRO la validation : changer d'attestation ne doit pas
-- conserver le feu vert donné sur la précédente.

create or replace function public.deposer_assurance_by_token(
  p_token    text,
  p_type     text,
  p_url      text,
  p_assureur text default null,
  p_police   text default null,
  p_echeance date default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
begin
  select id into v_id from public.artisans
   where token = p_token and ecarte_at is null;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if p_type not in ('decennale', 'rc_pro') then
    return json_build_object('ok', false, 'error', 'type_invalide',
                             'types_admis', array['decennale', 'rc_pro']);
  end if;

  if coalesce(btrim(p_url), '') = '' then
    return json_build_object('ok', false, 'error', 'fichier_requis');
  end if;

  -- Une attestation déjà expirée ne sert à rien : autant le dire tout de suite
  -- plutôt que de laisser l'agence la refuser trois jours plus tard.
  if p_echeance is not null and p_echeance < current_date then
    return json_build_object('ok', false, 'error', 'attestation_expiree',
                             'echeance', p_echeance);
  end if;

  if p_type = 'decennale' then
    update public.artisans
       set assurance_decennale = true,
           assurance_decennale_url = p_url,
           assurance_decennale_assureur = nullif(btrim(p_assureur), ''),
           assurance_decennale_police = nullif(btrim(p_police), ''),
           assurance_decennale_echeance = p_echeance,
           assurances_validees_at = null,
           assurances_validees_par = null
     where id = v_id;
  else
    update public.artisans
       set assurance_rc_pro = true,
           assurance_rc_pro_url = p_url,
           assurance_rc_pro_assureur = nullif(btrim(p_assureur), ''),
           assurance_rc_pro_police = nullif(btrim(p_police), ''),
           assurance_rc_pro_echeance = p_echeance,
           assurances_validees_at = null,
           assurances_validees_par = null
     where id = v_id;
  end if;

  -- L'agence doit savoir qu'il y a une pièce à regarder.
  insert into public.notifications (type, titre, message)
  values ('assurance_deposee',
    'Assurance à valider : ' || coalesce(
      (select coalesce(societe, nom) from public.artisans where id = v_id), 'artisan'),
    case p_type when 'decennale' then 'Décennale' else 'RC pro' end
      || coalesce(' — ' || p_assureur, '')
      || coalesce(' — échéance ' || to_char(p_echeance, 'DD/MM/YYYY'), ''));

  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.deposer_assurance_by_token(text, text, text, text, text, date) from public;
grant execute on function public.deposer_assurance_by_token(text, text, text, text, text, date) to anon, authenticated;

-- ---------- 4) L'agence valide ----------

create or replace function public.valider_assurances(p_artisan_id uuid, p_valide boolean default true)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare a public.artisans;
begin
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  select * into a from public.artisans where id = p_artisan_id;
  if a.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  if p_valide then
    -- Les deux pièces sont exigées : la décennale couvre l'ouvrage, la RC pro
    -- le dommage causé pendant le chantier. Valider sur une seule reviendrait
    -- à laisser un trou qu'on découvrirait au sinistre.
    if coalesce(a.assurance_decennale_url, '') = ''
       or coalesce(a.assurance_rc_pro_url, '') = '' then
      return json_build_object('ok', false, 'error', 'pieces_manquantes');
    end if;
  end if;

  update public.artisans
     set assurances_validees_at = case when p_valide then now() end,
         assurances_validees_par = case when p_valide then auth.uid() end
   where id = p_artisan_id;

  return json_build_object('ok', true, 'validees', p_valide);
end
$function$;

revoke execute on function public.valider_assurances(uuid, boolean) from public, anon;
grant execute on function public.valider_assurances(uuid, boolean) to authenticated;

-- ---------- 5) L'état du chiffrage, vu de l'espace artisan ----------
--
-- Fonction à part plutôt qu'un champ de plus dans `get_espace_artisan` : cette
-- dernière construit déjà un JSON de plus de deux cents lignes, et la
-- réécrire en entier pour y ajouter un drapeau serait une prise de risque
-- sans contrepartie.

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

  -- Une validation ne vaut que tant que les pièces sont valables : une
  -- décennale expirée referme l'accès toute seule, sans intervention.
  v_ok := a.assurances_validees_at is not null
      and coalesce(a.assurance_decennale_echeance, 'infinity'::date) >= current_date
      and coalesce(a.assurance_rc_pro_echeance,    'infinity'::date) >= current_date;

  return json_build_object(
    'peut_chiffrer', v_ok,
    'validees_le', a.assurances_validees_at,
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
