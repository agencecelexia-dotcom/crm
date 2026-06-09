-- ============================================================
--  0025 — RPC recentrées sur le token d'AFFECTATION (isolation par artisan).
--  + retrait automatique des autres artisans quand l'un signe le devis.
-- ============================================================

-- Espace artisan : liste les AFFECTATIONS de l'artisan (1 par chantier qu'on lui a confié)
create or replace function public.get_espace_artisan(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
begin
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  c := public.ensure_engagement_contrat(a.id);
  v_signe := c.statut = 'signe';

  return json_build_object(
    'artisan', json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe),
    'engagement', json_build_object(
      'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
      'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
      'signature_data', c.signature_data, 'apporteur_signature', c.apporteur_signature
    ),
    'signe', v_signe,
    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          case af.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', af.id,
            'token', af.token,                          -- token d'AFFECTATION (actions isolées)
            'statut', af.statut,
            'metier', p.metier,
            'metiers', p.metiers,
            'sous_metier', p.sous_metier,
            'description', p.description,
            'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis,
            'montant_devis_signe', af.montant_devis_signe,
            'client_ville', p.client_ville,
            'photos', coalesce(p.photos, '{}'),
            'devis_depose', af.devis_url is not null,
            'devis_signe_depose', af.devis_signe_url is not null,
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.affectation_id = af.id
            )
          ) as p_json
        from public.affectations af
        join public.projets p on p.id = af.projet_id
        where af.artisan_id = a.id
      ) sub
    )
  );
end;
$func$;
grant execute on function public.get_espace_artisan(text) to anon, authenticated;

-- Suivi par token d'affectation (+ retrait auto des autres si devis signé)
create or replace function public.add_suivi_by_token(
  p_token text, p_statut text default null, p_message text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  if coalesce(p_statut, '') <> '' then
    update public.affectations set statut = p_statut where id = af.id;
    select * into af from public.affectations where id = af.id;
  end if;

  if p_statut = 'devis_signe' then
    -- Affaire gagnée : les autres artisans sont retirés du projet
    delete from public.affectations where projet_id = af.projet_id and id <> af.id;
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;
  elsif p_statut in ('contacte', 'rdv_pris', 'devis_envoye', 'termine', 'perdu') then
    -- Pipeline agence = statut le plus avancé parmi les affectations restantes
    update public.projets p set statut = coalesce((
      select af2.statut from public.affectations af2
      where af2.projet_id = p.id and af2.statut <> 'perdu'
      order by case af2.statut
        when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
        when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
      limit 1), p.statut)
      where p.id = af.projet_id;
  end if;

  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.add_suivi_by_token(text, text, text) to anon, authenticated;

-- Montant du devis (sur l'affectation)
create or replace function public.set_montant_by_token(
  p_token text, p_slot text, p_montant numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if p_slot = 'devis' then
    update public.affectations set montant_devis = p_montant where id = af.id;
  elsif p_slot = 'devis_signe' then
    update public.affectations set montant_devis_signe = p_montant where id = af.id;
  else
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.set_montant_by_token(text, text, numeric) to anon, authenticated;

-- Enregistre l'URL (publique) du devis déposé (sur l'affectation)
create or replace function public.set_devis_by_token(
  p_token text, p_slot text, p_url text
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if p_slot = 'devis' then
    update public.affectations set devis_url = p_url where id = af.id;
  elsif p_slot = 'devis_signe' then
    update public.affectations set devis_signe_url = p_url where id = af.id;
  else
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.set_devis_by_token(text, text, text) to anon, authenticated;

-- Édition des infos client (token d'affectation → projet). Téléphone non modifiable.
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
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;

  update public.projets set
    client_nom = coalesce(nullif(p_client_nom, ''), client_nom),
    client_email = nullif(p_client_email, ''),
    client_adresse = nullif(p_client_adresse, ''),
    client_code_postal = nullif(p_client_code_postal, ''),
    client_ville = nullif(p_client_ville, ''),
    description = nullif(p_description, ''),
    budget_estime = p_budget
  where id = af.projet_id;

  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.update_projet_by_token(
  text, text, text, text, text, text, text, numeric
) to anon, authenticated;
