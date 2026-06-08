-- ============================================================
--  0020 — Statut "terminé" + redirection des anciens liens projet
--  vers le portail artisan (get_mission_by_token renvoie artisan_token).
-- ============================================================

-- 1) Autoriser le statut 'termine' (remplace la contrainte CHECK existante)
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.projets'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%statut%';
  if c is not null then
    execute 'alter table public.projets drop constraint ' || quote_ident(c);
  end if;
end$$;

alter table public.projets
  add constraint projets_statut_check check (statut in (
    'nouveau', 'a_rappeler', 'en_attente', 'artisan_assigne',
    'devis_envoye', 'devis_signe', 'termine', 'perdu'
  ));

-- 2) add_suivi_by_token : synchroniser aussi 'termine'
create or replace function public.add_suivi_by_token(
  p_token text, p_statut text default null, p_message text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  pj public.projets;
  v_type text;
begin
  select * into pj from public.projets where token = p_token;
  if pj.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  v_type := case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end;
  insert into public.suivis (projet_id, auteur, type, statut_artisan, message)
  values (pj.id, 'artisan', v_type, nullif(p_statut, ''), nullif(p_message, ''));

  if p_statut in ('devis_envoye', 'devis_signe', 'termine', 'perdu') then
    update public.projets set statut = p_statut where id = pj.id;
  end if;

  return json_build_object('ok', true);
end;
$func$;

grant execute on function public.add_suivi_by_token(text, text, text) to anon, authenticated;

-- 3) get_mission_by_token : ajouter artisan_token (pour rediriger les anciens
--    liens /mission/:token vers le portail /artisan/:token)
create or replace function public.get_mission_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  p public.projets;
  a public.artisans;
  c public.contrats;
begin
  select * into p from public.projets where token = p_token;
  if p.id is null then return null; end if;

  if p.artisan_id is not null then
    select * into a from public.artisans where id = p.artisan_id;
    c := public.ensure_engagement_contrat(p.artisan_id);
  end if;

  return json_build_object(
    'artisan_token', a.token,
    'projet', json_build_object(
      'client_nom', p.client_nom,
      'client_telephone', p.client_telephone,
      'client_email', p.client_email,
      'client_adresse', p.client_adresse,
      'client_code_postal', p.client_code_postal,
      'client_ville', p.client_ville,
      'metier', p.metier,
      'sous_metier', p.sous_metier,
      'description', p.description,
      'budget_estime', p.budget_estime,
      'statut', p.statut,
      'photos', coalesce(p.photos, '{}'),
      'devis_depose', p.devis_url is not null,
      'devis_signe_depose', p.devis_signe_url is not null
    ),
    'artisan', case when a.id is not null
      then json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe)
      else null end,
    'engagement', case when c.id is not null
      then json_build_object(
        'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
        'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
        'signature_data', c.signature_data,
        'apporteur_signature', c.apporteur_signature)
      else null end,
    'suivis', (
      select coalesce(json_agg(json_build_object(
        'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
        'message', s.message, 'created_at', s.created_at
      ) order by s.created_at), '[]'::json)
      from public.suivis s where s.projet_id = p.id
    )
  );
end;
$func$;

grant execute on function public.get_mission_by_token(text) to anon, authenticated;
