-- Le jeton d'un artisan n'est lisible que par le fondateur.
--
-- Le jeton `artisans.token` est la clé MAÎTRE de l'espace d'un artisan : tous
-- ses chantiers, les noms, téléphones et adresses de tous ses clients, ses
-- devis, ses montants — sans mot de passe.
--
-- Or la politique `artisans_lecture` est `using (true)` pour tout membre
-- connecté, colonne comprise. L'audit sécurité l'a prouvé avec le compte d'un
-- commercial qui ne voit AUCUN projet par la RLS : il lisait les 103 jetons,
-- et par `get_espace_artisan` obtenait 162 fiches chantier avec le téléphone
-- du client. Et `artisans_ecriture` lui permettait de RÉÉCRIRE un jeton —
-- donc d'en fixer un qu'il connaît.
--
-- Une politique RLS ne masque pas une colonne : ce sont les privilèges de
-- colonne qui le font. Le jeton sort de la lecture et de l'écriture
-- ordinaires ; le fondateur l'obtient, et le renouvelle, par deux fonctions
-- qui vérifient son rôle.
--
-- `anon` n'avait aucune raison de détenir des droits sur cette table (seule la
-- RLS le bloquait) : il n'en a plus. L'inscription passe par `inscrire_artisan`.

-- Cette migration ne crée que les deux fonctions : elle est additive, sans
-- effet sur l'écran en ligne. Le retrait du jeton des privilèges de colonne
-- (0161) ne s'applique qu'une fois le front qui les utilise déployé — sinon
-- ses `select('*')` sur `artisans` échoueraient pour tout le monde.

create or replace function public.jeton_espace_artisan(p_artisan_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.est_fondateur() then return null; end if;
  return (select token from public.artisans where id = p_artisan_id);
end
$function$;

create or replace function public.regenerer_jeton_artisan(p_artisan_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v text;
begin
  if not public.est_fondateur() then
    raise exception 'reserve_fondateur' using errcode = '42501';
  end if;
  update public.artisans
     set token = replace(gen_random_uuid()::text, '-', '')
   where id = p_artisan_id
  returning token into v;
  return v;
end
$function$;

revoke execute on function public.jeton_espace_artisan(uuid) from public, anon;
revoke execute on function public.regenerer_jeton_artisan(uuid) from public, anon;
grant execute on function public.jeton_espace_artisan(uuid) to authenticated;
grant execute on function public.regenerer_jeton_artisan(uuid) to authenticated;
