-- ============================================================
--  0021 — Statuts plus fins (contacté, RDV pris) synchronisés depuis
--  l'artisan + saisie du montant du devis par l'artisan.
-- ============================================================

-- 1) Élargir la contrainte de statut (ajout contacte, rdv_pris)
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
    'contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine', 'perdu'
  ));

-- 2) add_suivi_by_token : synchroniser TOUS les statuts déclarés par l'artisan
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

  if p_statut in ('contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine', 'perdu') then
    update public.projets set statut = p_statut where id = pj.id;
  end if;

  return json_build_object('ok', true);
end;
$func$;

grant execute on function public.add_suivi_by_token(text, text, text) to anon, authenticated;

-- 3) L'artisan saisit le montant du devis (TTC). Le montant signé alimente la
--    commission (colonne générée). Sécurisé par le token du projet.
create or replace function public.set_montant_by_token(
  p_token text, p_slot text, p_montant numeric
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
  if p_slot = 'devis' then
    update public.projets set montant_devis = p_montant where id = pj.id;
  elsif p_slot = 'devis_signe' then
    update public.projets set montant_devis_signe = p_montant where id = pj.id;
  else
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true);
end;
$func$;

grant execute on function public.set_montant_by_token(text, text, numeric) to anon, authenticated;

-- 4) get_espace_artisan : renvoyer aussi les montants (pour pré-remplir la saisie)
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
          case p.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', p.id,
            'token', p.token,
            'statut', p.statut,
            'metier', p.metier,
            'metiers', p.metiers,
            'sous_metier', p.sous_metier,
            'description', p.description,
            'budget_estime', p.budget_estime,
            'montant_devis', p.montant_devis,
            'montant_devis_signe', p.montant_devis_signe,
            'client_ville', p.client_ville,
            'photos', coalesce(p.photos, '{}'),
            'devis_depose', p.devis_url is not null,
            'devis_signe_depose', p.devis_signe_url is not null,
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
              from public.suivis s where s.projet_id = p.id
            )
          ) as p_json
        from public.projets p
        where p.artisan_id = a.id
      ) sub
    )
  );
end;
$func$;

grant execute on function public.get_espace_artisan(text) to anon, authenticated;
