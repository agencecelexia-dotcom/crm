-- Le contexte d'un chantier, pour proposer des lignes de devis.
--
-- CE QUE ÇA SERT
--
-- « En fonction de ce qui s'est dit pendant les appels, il clique et ça met la
-- ligne. » Pour cela il faut rassembler ce qu'on sait du chantier : la demande
-- initiale, le métier, et surtout l'HISTORIQUE DES ÉCHANGES — c'est là que se
-- trouve le détail utile (« il veut aussi le portillon », « la façade nord est
-- en pierre »), pas dans la fiche.
--
-- Une fonction dédiée plutôt qu'un passage par `get_espace_artisan` : on n'a
-- besoin que d'un chantier, et cette dernière en renvoie cent.

create or replace function public.contexte_devis_by_token(
  p_token text,
  p_affectation_token text
)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
  p public.projets;
begin
  select id into v_artisan from public.artisans
   where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  -- L'affectation doit appartenir à CET artisan : sans ce contrôle, un jeton
  -- de chantier glané ailleurs donnerait accès au dossier d'un concurrent.
  select * into af from public.affectations
   where token = p_affectation_token and artisan_id = v_artisan;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;

  select * into p from public.projets where id = af.projet_id;

  return json_build_object(
    'ok', true,
    'metier', p.metier,
    'metiers', p.metiers,
    'sous_metier', p.sous_metier,
    'description', p.description,
    'budget_estime', p.budget_estime,
    'ville', p.client_ville,
    'code_postal', p.client_code_postal,
    -- Les échanges, du plus ancien au plus récent : c'est la chronologie qui
    -- donne le sens (« finalement il ne veut plus le portail »).
    'echanges', coalesce((
      select json_agg(json_build_object(
        'auteur', s.auteur, 'message', s.message, 'statut', s.statut_artisan,
        'le', s.created_at) order by s.created_at)
      from public.suivis s
      where s.affectation_id = af.id
        and coalesce(btrim(s.message), '') <> ''
    ), '[]'::json)
  );
end
$function$;

revoke execute on function public.contexte_devis_by_token(text, text) from public;
grant execute on function public.contexte_devis_by_token(text, text) to anon, authenticated;
