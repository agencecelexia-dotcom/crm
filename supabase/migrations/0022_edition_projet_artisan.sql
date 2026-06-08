-- ============================================================
--  0022 — L'artisan peut éditer les infos du prospect depuis son espace
--  (tout SAUF le numéro de téléphone). Sécurisé par le token du projet.
-- ============================================================
create or replace function public.update_projet_by_token(
  p_token text,
  p_client_nom text,
  p_client_email text,
  p_client_adresse text,
  p_client_code_postal text,
  p_client_ville text,
  p_description text,
  p_budget numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare pj public.projets;
begin
  select * into pj from public.projets where token = p_token;
  if pj.id is null then return json_build_object('ok', false); end if;

  update public.projets set
    -- nom NOT NULL : on garde l'ancien si on tente de le vider
    client_nom = coalesce(nullif(p_client_nom, ''), client_nom),
    client_email = nullif(p_client_email, ''),
    client_adresse = nullif(p_client_adresse, ''),
    client_code_postal = nullif(p_client_code_postal, ''),
    client_ville = nullif(p_client_ville, ''),
    description = nullif(p_description, ''),
    budget_estime = p_budget
    -- NB : client_telephone volontairement NON modifiable par l'artisan
  where id = pj.id;

  return json_build_object('ok', true);
end;
$func$;

grant execute on function public.update_projet_by_token(
  text, text, text, text, text, text, text, numeric
) to anon, authenticated;
