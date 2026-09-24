-- Un contrat signé est figé, et l'on peut prouver ce qui a été signé.
--
-- L'audit des parcours publics l'a établi :
--   - 17 des 67 contrats signés ont été RÉÉCRITS après leur signature (deux
--     lots, les 8 et 19 juin : « corrigé dans le modèle et les 33 contrats déjà
--     stockés »). Le texte affiché ou téléchargé aujourd'hui n'est plus celui
--     que l'artisan a signé, et rien ne permet de retrouver l'original ;
--   - rien ne fige le texte : ni empreinte, ni IP, ni navigateur ; la date de
--     signature n'est même pas dans le texte stocké (injectée à l'affichage) ;
--   - `signer_contrat(jeton, '', '')` passait le contrat en « signé » avec un nom
--     vide et une signature vide ;
--   - un artisan écarté pouvait encore lire et signer son contrat.
--
-- DÉSORMAIS
--   - À la signature, le texte FINAL (date comprise, à l'heure de Paris) est
--     écrit dans `contenu` : tous les écrans et le PDF affichent donc le texte
--     signé, sans autre changement. On garde son empreinte SHA-256, l'adresse
--     IP et le navigateur du signataire.
--   - Un contrat signé ne se modifie plus et ne redevient pas « à signer ».
--   - Nom et signature sont exigés ; un artisan écarté ne lit ni ne signe plus.
--
-- LES CONTRATS DÉJÀ SIGNÉS
-- On ne peut rien prouver de plus qu'on ne sait. `preuve` le dit, contrat par
-- contrat :
--   - 'reconstituee' : texte jamais modifié depuis la signature (updated_at ≤
--     signed_at) — date insérée et empreinte calculée aujourd'hui ;
--   - 'texte_modifie_apres_signature' : le texte actuel n'est PAS celui signé.
--     Seule une nouvelle signature y remédie : décision du fondateur.

alter table public.contrats add column if not exists empreinte text;
alter table public.contrats add column if not exists signe_ip text;
alter table public.contrats add column if not exists signe_navigateur text;
alter table public.contrats add column if not exists preuve text
  check (preuve is null or preuve in ('signature', 'reconstituee', 'texte_modifie_apres_signature'));

-- La date telle que l'écran l'écrit (jj/mm/aaaa), à l'heure de Paris.
create or replace function public.contenu_signe(p_contenu text, p_signed_at timestamptz)
returns text
language sql
immutable
as $function$
  select replace(p_contenu, '{{DATE_SIGNATURE}}',
                 to_char(p_signed_at at time zone 'Europe/Paris', 'DD/MM/YYYY'));
$function$;

-- ---------- Signer ----------

create or replace function public.signer_contrat(p_token text, p_signataire text, p_signature text)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  r public.contrats;
  v_entetes json;
  v_maintenant timestamptz := now();
begin
  if coalesce(length(btrim(p_signataire)), 0) < 2 then
    return json_build_object('ok', false, 'error', 'nom_requis');
  end if;
  -- Une image de signature, et pas une chaîne vide ou arbitraire.
  if p_signature is null or p_signature not like 'data:image/%' or length(p_signature) < 200 then
    return json_build_object('ok', false, 'error', 'signature_requise');
  end if;

  if exists (select 1 from public.contrats c join public.artisans a on a.id = c.artisan_id
              where c.token = p_token and a.ecarte_at is not null) then
    return json_build_object('ok', false, 'error', 'artisan_ecarte');
  end if;

  v_entetes := nullif(current_setting('request.headers', true), '')::json;

  update public.contrats
     set statut = 'signe',
         signataire_nom = btrim(p_signataire),
         signature_data = p_signature,
         signed_at = v_maintenant,
         contenu = public.contenu_signe(contenu, v_maintenant),
         empreinte = public.empreinte(public.contenu_signe(contenu, v_maintenant)),
         signe_ip = btrim(split_part(coalesce(v_entetes->>'x-forwarded-for', v_entetes->>'x-real-ip', ''), ',', 1)),
         signe_navigateur = left(v_entetes->>'user-agent', 400),
         preuve = 'signature'
   where token = p_token and statut <> 'signe'
   returning * into r;

  if r.id is null then
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true, 'signed_at', r.signed_at, 'empreinte', r.empreinte);
end;
$function$;

-- ---------- Lire ----------

create or replace function public.get_contrat_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare j json;
begin
  select json_build_object(
    'id', c.id,
    'type', c.type,
    'contenu', c.contenu,
    'statut', c.statut,
    'signataire_nom', c.signataire_nom,
    'signed_at', c.signed_at,
    'signature_data', c.signature_data,
    'apporteur_signature', c.apporteur_signature,
    'empreinte', c.empreinte,
    'artisan', json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe)
  ) into j
  from public.contrats c
  join public.artisans a on a.id = c.artisan_id
  where c.token = p_token
    and a.ecarte_at is null;   -- un artisan écarté ne lit plus son contrat
  return j;
end;
$function$;

-- ---------- Verrouiller ----------

create or replace function public.trg_contrat_signe_fige()
returns trigger
language plpgsql
as $function$
begin
  if old.statut = 'signe' and (
       new.statut is distinct from old.statut
    or new.contenu is distinct from old.contenu
    or new.signature_data is distinct from old.signature_data
    or new.signataire_nom is distinct from old.signataire_nom
    or new.signed_at is distinct from old.signed_at
    or new.empreinte is distinct from old.empreinte
    or new.signe_ip is distinct from old.signe_ip
    or new.signe_navigateur is distinct from old.signe_navigateur
  ) then
    raise exception 'Un contrat signé ne se modifie plus : faites-en signer un nouveau.'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

-- ---------- Les contrats déjà signés ----------
-- (avant la pose du verrou, qui interdirait ces mises à jour)

update public.contrats
   set contenu = public.contenu_signe(contenu, signed_at),
       empreinte = public.empreinte(public.contenu_signe(contenu, signed_at)),
       preuve = 'reconstituee'
 where statut = 'signe' and signed_at is not null
   and updated_at <= signed_at + interval '5 seconds';

update public.contrats
   set preuve = 'texte_modifie_apres_signature'
 where statut = 'signe' and preuve is null;

drop trigger if exists trg_contrat_signe_fige on public.contrats;
create trigger trg_contrat_signe_fige
  before update on public.contrats
  for each row execute function public.trg_contrat_signe_fige();
