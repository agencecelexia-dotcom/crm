-- Les fichiers publics ne portent plus aucun jeton dans leur adresse.
--
-- DEUX DÉFAUTS, UNE CAUSE
--
-- 1. LA FUITE. Le logo de l'artisan était rangé sous `logos/<jeton artisan>/`
--    et le PDF de ses devis sous `<jeton artisan>/genere-…`, dans le bucket
--    PUBLIC `devis`. Le logo part dans le HTML du devis envoyé au client : tout
--    particulier qui recevait un devis lisait dans la source de l'e-mail le
--    jeton MAÎTRE de l'artisan, et ouvrait son espace — les noms, téléphones et
--    adresses de tous ses autres clients, ses devis, ses montants.
--
-- 2. LA PANNE. Le PDF généré était déposé sous le jeton de l'ARTISAN, quand la
--    politique n'autorisait un dépôt anonyme que sous un jeton d'AFFECTATION.
--    Depuis le 17 juillet, aucun devis généré depuis l'espace artisan n'a pu
--    enregistrer son PDF ; DEV-2026-0014, 0015 et 0016 (12 septembre) sont
--    restés en brouillon — trois essais d'un artisan, sans PDF ni envoi.
--
-- LA RÈGLE
--
-- Un dépôt anonyme est rangé sous l'EMPREINTE SHA-256 du jeton, jamais sous le
-- jeton : l'adresse publique ne révèle rien, et la base retrouve quand même le
-- propriétaire en recalculant l'empreinte. Le navigateur calcule la même
-- (crypto.subtle), vérifié octet pour octet.
--
--   logos/<empreinte artisan>/…        logo de l'entreprise
--   genere/<empreinte artisan>/…       PDF d'un devis généré
--   chantier/<empreinte affectation>/… devis ou devis signé déposé sur un chantier
--
-- Les anciennes politiques restent le temps que le nouveau front soit en ligne
-- (0159 les retire) : les supprimer maintenant casserait l'écran actuellement
-- servi par Vercel.

create or replace function public.empreinte(p text)
returns text
language sql
immutable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex');
$function$;

create or replace function public.empreinte_artisan_valide(p_empreinte text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.artisans
     where token is not null and ecarte_at is null
       and public.empreinte(token) = p_empreinte
  );
$function$;

create or replace function public.empreinte_affectation_valide(p_empreinte text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.affectations af
      join public.artisans a on a.id = af.artisan_id
     where af.token is not null and af.retire_at is null and a.ecarte_at is null
       and public.empreinte(af.token) = p_empreinte
  );
$function$;

-- Les politiques de stockage les appellent en tant qu'anon.
grant execute on function public.empreinte_artisan_valide(text) to anon, authenticated;
grant execute on function public.empreinte_affectation_valide(text) to anon, authenticated;
grant execute on function public.empreinte(text) to anon, authenticated;

drop policy if exists devis_depot_empreinte on storage.objects;
create policy devis_depot_empreinte on storage.objects
  for insert to anon
  with check (
    bucket_id = 'devis'
    and (
      (split_part(name, '/', 1) in ('logos', 'genere')
        and public.empreinte_artisan_valide(split_part(name, '/', 2)))
      or (split_part(name, '/', 1) = 'chantier'
        and public.empreinte_affectation_valide(split_part(name, '/', 2)))
    )
  );
