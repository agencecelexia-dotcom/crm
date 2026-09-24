-- Les anciens liens « /mission/<jeton de projet> » n'ouvrent plus rien.
--
-- `get_mission_by_token`, exécutable par anon, renvoyait :
--   - `artisan_token`, le jeton MAÎTRE de l'artisan titulaire actuel du chantier.
--     Le lien est attaché au chantier, pas à l'artisan : quand le chantier
--     passait de A à B, le lien de A ouvrait tout l'espace de B (tous ses
--     chantiers, les coordonnées de tous ses clients) ;
--   - le nom, le téléphone, l'e-mail et l'adresse du client, sans condition de
--     signature, contrairement à ce que disait son propre commentaire ;
--   - les échanges de TOUTES les affectations du chantier, concurrents compris.
--
-- Prouvé par l'audit sécurité sur un chantier réel à deux artisans. Un jeton de
-- chantier ne peut pas dire qui clique : aucune redirection n'est sûre. La
-- fonction est conservée (des onglets restent ouverts) mais ne renvoie plus
-- rien ; la page explique où trouver le lien de l'espace personnel.

create or replace function public.get_mission_by_token(p_token text)
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select null::json;
$function$;
