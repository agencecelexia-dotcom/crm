-- « Métrés prêts » dans la liste des chantiers de l'artisan.
--
-- La pré-mesure (0174) remplit le dossier de métrés avant que l'artisan ne
-- l'ouvre ; encore faut-il qu'il le sache. Pour chacun de ses chantiers :
-- combien de quantités ont une valeur retenue, et combien attendent une
-- vérification de l'agence.

create or replace function public.etats_metrage_by_token(p_token text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
begin
  select id into v_artisan from public.artisans where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  return json_build_object('ok', true, 'chantiers', (
    select coalesce(json_agg(json_build_object(
             'affectation_token', a.token,
             'retenues', (select count(*) from public.metrage_chantier m
                           where m.projet_id = a.projet_id and m.valeur_retenue is not null),
             'a_verifier', (select count(*) from public.metrage_chantier m
                             where m.projet_id = a.projet_id and m.statut in ('ecart', 'sources_desaccord'))
           )), '[]'::json)
      from public.affectations a
     where a.artisan_id = v_artisan and a.retire_at is null));
end
$function$;

revoke execute on function public.etats_metrage_by_token(text) from public;
grant execute on function public.etats_metrage_by_token(text) to anon, authenticated;
