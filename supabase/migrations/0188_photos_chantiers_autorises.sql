-- Garde serveur pour facade-photo. Aucun changement du cache géographique :
-- le bâtiment doit être relié à un chantier actif de cet artisan sous contrat.
create or replace function public.autoriser_photos_batiment(p_token text, p_cleabs text)
returns json language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare a public.artisans;
begin
  select * into a from public.artisans where token = p_token and ecarte_at is null;
  if a.id is null then return json_build_object('ok', false, 'error', 'token_invalide'); end if;
  if p_cleabs is null or p_cleabs !~ '^BATIMENT[0-9]{16}$' then
    return json_build_object('ok', false, 'error', 'batiment_invalide');
  end if;
  if not coalesce(a.contrat_externe, false)
     and not coalesce((select c.statut = 'signe' from public.contrats c where c.artisan_id = a.id order by c.created_at asc limit 1), false) then
    return json_build_object('ok', false, 'error', 'contrat_requis');
  end if;
  if not exists (
    select 1 from public.affectations af join public.projets p on p.id = af.projet_id
     where af.artisan_id = a.id and p.batiment_cleabs = p_cleabs
       and public.acces_suivi_par_jeton(af.token) is null
  ) then return json_build_object('ok', false, 'error', 'batiment_non_attribue'); end if;
  return json_build_object('ok', true);
end
$function$;
revoke execute on function public.autoriser_photos_batiment(text, text) from public, anon, authenticated;
grant execute on function public.autoriser_photos_batiment(text, text) to service_role;
