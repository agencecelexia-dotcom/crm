-- 0041 — Générateur de devis dans l'espace artisan (Metbach uniquement).
-- Table devis + numérotation + RPC token (security definer, refusent tout autre
-- artisan que Metbach) + extension de get_espace_artisan (id + infos société).

create sequence if not exists public.devis_seq;

create table if not exists public.devis (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  projet_id uuid references public.projets(id) on delete set null,
  affectation_id uuid references public.affectations(id) on delete set null,
  numero text not null unique,
  client_nom text, client_adresse text, client_cp text, client_ville text,
  client_email text, client_tel text,
  objet text,
  lignes jsonb not null default '[]',   -- [{designation, quantite, unite, prix_unitaire}]
  total numeric not null default 0,
  acompte_pct numeric, conditions text, notes text,
  date_devis date not null default current_date,
  date_validite date,
  pdf_url text,
  statut text not null default 'brouillon',  -- brouillon | envoye
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_devis_artisan on public.devis (artisan_id, created_at desc);

alter table public.devis enable row level security;
drop policy if exists "devis_auth" on public.devis;
create policy "devis_auth" on public.devis for all to authenticated using (true) with check (true);

-- ---------- RPC (réservées à Metbach via son token d'espace) ----------
-- Helper : renvoie l'artisan SI son token correspond ET que c'est Metbach.
create or replace function public._devis_artisan(p_token text)
returns public.artisans language sql stable security definer set search_path = public as $$
  select * from public.artisans
  where token = p_token and id = '98a39398-2b7f-4a44-b9bc-aa6f893e9d32'::uuid;
$$;

create or replace function public.creer_devis_by_token(p_token text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare a public.artisans; af public.affectations; v_num text; v_id uuid;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false, 'error', 'non autorisé'); end if;

  if coalesce(p_payload->>'affectation_token','') <> '' then
    select * into af from public.affectations
      where token = p_payload->>'affectation_token' and artisan_id = a.id;
  end if;

  v_num := 'DEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.devis_seq')::text, 4, '0');

  insert into public.devis (
    artisan_id, projet_id, affectation_id, numero,
    client_nom, client_adresse, client_cp, client_ville, client_email, client_tel,
    objet, lignes, total, acompte_pct, conditions, notes, date_validite
  ) values (
    a.id, af.projet_id, af.id, v_num,
    p_payload->>'client_nom', p_payload->>'client_adresse', p_payload->>'client_cp',
    p_payload->>'client_ville', p_payload->>'client_email', p_payload->>'client_tel',
    p_payload->>'objet', coalesce(p_payload->'lignes','[]'::jsonb),
    coalesce((p_payload->>'total')::numeric, 0),
    nullif(p_payload->>'acompte_pct','')::numeric,
    p_payload->>'conditions', p_payload->>'notes',
    nullif(p_payload->>'date_validite','')::date
  ) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'numero', v_num);
end;
$$;

create or replace function public.set_devis_pdf_by_token(p_token text, p_devis_id uuid, p_url text)
returns json language plpgsql security definer set search_path = public as $$
declare a public.artisans;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false); end if;
  update public.devis set pdf_url = p_url where id = p_devis_id and artisan_id = a.id;
  return json_build_object('ok', found);
end;
$$;

create or replace function public.envoyer_devis_by_token(p_token text, p_devis_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare a public.artisans; d public.devis;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false); end if;
  select * into d from public.devis where id = p_devis_id and artisan_id = a.id;
  if d.id is null then return json_build_object('ok', false); end if;

  update public.devis set statut = 'envoye', sent_at = now() where id = d.id;

  -- Répercussion CRM si le devis vient d'un projet (affectation)
  if d.affectation_id is not null then
    update public.affectations
      set devis_url = coalesce(d.pdf_url, devis_url), montant_devis = d.total, statut = 'devis_envoye'
      where id = d.affectation_id;
    insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
      values (d.projet_id, d.affectation_id, 'artisan', 'statut', 'devis_envoye',
              'Devis ' || d.numero || ' envoyé (' || round(d.total)::text || ' €)');
    update public.projets p set statut = coalesce(
      (select af2.statut from public.affectations af2
        where af2.projet_id = p.id and af2.statut <> 'perdu'
        order by case af2.statut
          when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
          when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
        limit 1), 'perdu')
      where p.id = d.projet_id;
  end if;

  return json_build_object('ok', true, 'client_email', d.client_email,
                           'numero', d.numero, 'total', d.total, 'pdf_url', d.pdf_url);
end;
$$;

create or replace function public.list_devis_by_token(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare a public.artisans;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return '[]'::json; end if;
  return (
    select coalesce(json_agg(json_build_object(
      'id', d.id, 'numero', d.numero, 'client_nom', d.client_nom, 'objet', d.objet,
      'total', d.total, 'statut', d.statut, 'pdf_url', d.pdf_url,
      'date_devis', d.date_devis, 'sent_at', d.sent_at, 'projet_id', d.projet_id
    ) order by d.created_at desc), '[]'::json)
    from public.devis d where d.artisan_id = a.id
  );
end;
$$;

grant execute on function public._devis_artisan(text) to anon, authenticated;
grant execute on function public.creer_devis_by_token(text, jsonb) to anon, authenticated;
grant execute on function public.set_devis_pdf_by_token(text, uuid, text) to anon, authenticated;
grant execute on function public.envoyer_devis_by_token(text, uuid) to anon, authenticated;
grant execute on function public.list_devis_by_token(text) to anon, authenticated;

-- ---------- get_espace_artisan : ajoute id + infos société (en-tête devis) ----------
create or replace function public.get_espace_artisan(p_token text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
begin
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  c := public.ensure_engagement_contrat(a.id);
  v_signe := (c.statut = 'signe') or a.contrat_externe;

  return json_build_object(
    'artisan', json_build_object(
      'id', a.id, 'nom', a.nom, 'prenom', a.prenom, 'societe', a.societe,
      'adresse', a.adresse, 'code_postal', a.code_postal, 'ville', a.ville,
      'siren', a.siren, 'forme_juridique', a.forme_juridique,
      'telephone', a.telephone, 'email', a.email, 'representant', a.representant
    ),
    'engagement', json_build_object(
      'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
      'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
      'signature_data', c.signature_data, 'apporteur_signature', c.apporteur_signature
    ),
    'signe', v_signe,
    'contrat_externe', a.contrat_externe,
    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          case af.statut when 'perdu' then 2 when 'termine' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', af.id, 'token', af.token, 'statut', af.statut,
            'metier', p.metier, 'metiers', p.metiers, 'sous_metier', p.sous_metier,
            'description', p.description, 'budget_estime', p.budget_estime,
            'montant_devis', af.montant_devis, 'montant_devis_signe', af.montant_devis_signe,
            'client_ville', p.client_ville, 'photos', coalesce(p.photos, '{}'),
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
        where af.artisan_id = a.id and p.deleted_at is null
      ) sub
    )
  );
end;
$function$;
