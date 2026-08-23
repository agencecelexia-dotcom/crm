-- Suppression d'un commercial depuis l'écran Équipe.
--
-- Deux cas très différents, que l'écran ne doit pas confondre :
--
--   * un commercial qui n'a RIEN fait (invitation jamais honorée, erreur de
--     saisie) : sa fiche peut disparaître sans laisser de trou ;
--   * un commercial qui a travaillé : ses projets, ses suivis et ses
--     rétrocessions portent son identifiant. L'effacer rendrait ces lignes
--     orphelines et fausserait les commissions déjà versées.
--
-- Le second cas est donc refusé, avec le décompte de ce qui bloque. La bonne
-- action est alors la désactivation, qui coupe l'accès sans toucher à
-- l'historique — elle existe déjà sur l'écran.

create or replace function public.supprimer_commercial(p_membre_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_membre public.membres;
  v_projets int;
  v_retro int;
begin
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  select * into v_membre from public.membres where id = p_membre_id;
  if v_membre.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  -- Un fondateur ne se supprime pas depuis cet écran : ce serait le moyen le
  -- plus simple de se verrouiller soi-même hors du CRM.
  if v_membre.role = 'fondateur' then
    return json_build_object('ok', false, 'error', 'fondateur_non_supprimable');
  end if;

  select count(*) into v_projets
  from public.projets
  where created_by = v_membre.user_id or assigne_a = v_membre.user_id;

  select count(*) into v_retro
  from public.retrocessions where membre_id = p_membre_id;

  if v_projets > 0 or v_retro > 0 then
    return json_build_object(
      'ok', false,
      'error', 'a_de_lhistorique',
      'projets', v_projets,
      'retrocessions', v_retro
    );
  end if;

  delete from public.membres where id = p_membre_id;

  -- Le compte d'authentification est retiré dans la foulée : le laisser
  -- permettrait de se connecter à un CRM où plus rien n'est visible, ce qui
  -- serait incompréhensible pour la personne.
  delete from auth.users where id = v_membre.user_id;

  return json_build_object('ok', true);
end
$function$;

comment on function public.supprimer_commercial(uuid) is
  'Supprime un commercial sans historique, ainsi que son compte. Refuse si des '
  'projets ou des rétrocessions lui sont rattachés : désactiver, dans ce cas.';

revoke all on function public.supprimer_commercial(uuid) from public, anon;
grant execute on function public.supprimer_commercial(uuid) to authenticated;
