-- Une maison CALCULÉE qui ne tient plus disparaît du projet.
--
-- `enregistrer_batiment_projet` (0169) ne savait qu'écrire : ses `coalesce`
-- gardaient l'ancienne valeur dès qu'on lui passait « rien ». Quand un nouveau
-- calcul ne trouvait plus de maison sûre — une autre rue à Abbans-Dessus, un
-- abri de 29 m² à Dimbsthal —, l'ancien bâtiment restait sur le projet, prêt à
-- être lu comme « la maison » par l'agence ou par la pré-mesure.
--
-- Désormais le calcul écrit ce qu'il trouve, y compris « aucune maison ».
-- Une maison confirmée par un humain, ou choisie par l'artisan ou l'agence,
-- reste intouchable : c'est lui qui a vu la maison.

create or replace function public.enregistrer_batiment_projet(
  p_projet_id uuid, p_cleabs text, p_source text, p_adresse text, p_score numeric,
  p_lon numeric default null, p_lat numeric default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'error', 'reserve_service');
  end if;
  if p_cleabs is not null and p_cleabs !~ '^BATIMENT[0-9]{16}$' then
    return json_build_object('ok', false, 'error', 'batiment_invalide');
  end if;

  update public.projets
     set batiment_cleabs = p_cleabs,
         batiment_source = case when p_cleabs is null then null else p_source end,
         batiment_lon = case when p_cleabs is null then null else p_lon end,
         batiment_lat = case when p_cleabs is null then null else p_lat end,
         adresse_retrouvee = p_adresse,
         adresse_score = p_score,
         batiment_calcule_le = now()
   where id = p_projet_id
     and batiment_confirme_at is null
     and coalesce(batiment_source, '') not in ('artisan', 'agence');
  return json_build_object('ok', true);
end
$function$;

revoke execute on function public.enregistrer_batiment_projet(uuid, text, text, text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.enregistrer_batiment_projet(uuid, text, text, text, numeric, numeric, numeric) to service_role;
