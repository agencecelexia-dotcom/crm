-- Les liens d'inscription portent un jeton aléatoire, jamais le taux.
-- Une série par canal suffit au partage : aucune liste de jetons n'est publique.
create table public.liens_inscription_artisan (
  token text primary key default encode(extensions.gen_random_bytes(32), 'hex') check (token ~ '^[a-f0-9]{64}$'),
  canal text not null check (canal in ('lien','facebook','whatsapp','instagram','email')),
  taux integer not null check (taux in (10,15,20)),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  unique(canal,taux)
);
alter table public.liens_inscription_artisan enable row level security;
revoke all on public.liens_inscription_artisan from public, anon, authenticated;
grant select on public.liens_inscription_artisan to service_role;
insert into public.liens_inscription_artisan(canal,taux)
select canal,taux from unnest(array['lien','facebook','whatsapp','instagram','email']) canal
cross join unnest(array[10,15,20]) taux;

-- Seuls les membres autorisés à inviter peuvent copier les liens de l'agence.
create function public.liens_inscription_agence()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from public.membres where user_id=auth.uid() and actif
    and (role='fondateur' or peut_creer_artisan)) then
    raise exception 'non_autorise' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('token',token,'canal',canal,'taux',taux) order by canal,taux),'[]'::jsonb)
    from public.liens_inscription_artisan where actif);
end;
$$;
revoke all on function public.liens_inscription_agence() from public, anon;
grant execute on function public.liens_inscription_agence() to authenticated;

-- Le détenteur d'un lien ne peut résoudre que celui-ci, sans accéder aux autres.
create function public.lien_inscription_artisan(p_token text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('ok',true,'taux',taux,'canal',canal)
    from public.liens_inscription_artisan where token=p_token and actif),
    jsonb_build_object('ok',false,'error','lien_invalide'));
$$;
revoke all on function public.lien_inscription_artisan(text) from public;
grant execute on function public.lien_inscription_artisan(text) to anon, authenticated;

create or replace function public.inscrire_artisan(p_payload jsonb)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_token text; v_source text; v_contrat public.contrats; v_nb int; v_forme text; v_lien public.liens_inscription_artisan;
begin
  -- Le taux et le canal sont liés au jeton côté serveur. Aucun repli sur
  -- les anciens paramètres publics : enlever/modifier le jeton ne baisse pas le taux.
  select * into v_lien from public.liens_inscription_artisan
   where token = p_payload->>'invitation_token' and actif
   for share;
  if not found then
    return json_build_object('ok', false, 'error', 'Lien d’inscription invalide. Demandez un nouveau lien à Celexia.');
  end if;
  if coalesce(trim(p_payload->>'nom'),'') = '' and coalesce(trim(p_payload->>'societe'),'') = '' then
    return json_build_object('ok', false, 'error', 'Nom ou société requis');
  end if;
  v_source := 'auto:' || v_lien.canal;
  v_nb := nullif(p_payload->>'nb_salaries','')::int;
  v_forme := coalesce(nullif(trim(p_payload->>'forme_juridique'),''),
                      case when v_nb = 0 then 'EI' else null end);

  insert into public.artisans (
    nom, prenom, societe, telephone, email,
    metiers, sous_metiers, rayon_km, departements_couverts, zones_couvertes,
    adresse, ville, code_postal, latitude, longitude,
    forme_juridique, capital_social, siren, ville_immatriculation,
    representant, qualite_representant, taux_commission, specificites, source,
    nb_salaries, annees_experience, assurance_rc_pro, assurance_decennale
  ) values (
    coalesce(nullif(trim(p_payload->>'nom'),''), p_payload->>'societe', 'Artisan'),
    nullif(trim(p_payload->>'prenom'),''),
    nullif(trim(p_payload->>'societe'),''),
    nullif(trim(p_payload->>'telephone'),''),
    nullif(trim(p_payload->>'email'),''),
    array(select jsonb_array_elements_text(coalesce(p_payload->'metiers','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_payload->'sous_metiers','[]'::jsonb))),
    nullif(p_payload->>'rayon_km','')::int,
    array(select jsonb_array_elements_text(coalesce(p_payload->'departements_couverts','[]'::jsonb))),
    coalesce(p_payload->'zones_couvertes', '[]'::jsonb),
    nullif(trim(p_payload->>'adresse'),''),
    nullif(trim(p_payload->>'ville'),''),
    nullif(trim(p_payload->>'code_postal'),''),
    nullif(p_payload->>'latitude','')::float8,
    nullif(p_payload->>'longitude','')::float8,
    v_forme,
    nullif(trim(p_payload->>'capital_social'),''),
    nullif(trim(p_payload->>'siren'),''),
    nullif(trim(p_payload->>'ville_immatriculation'),''),
    nullif(trim(p_payload->>'representant'),''),
    nullif(trim(p_payload->>'qualite_representant'),''),
    v_lien.taux::numeric / 100,
    nullif(trim(p_payload->>'specificites'),''),
    v_source,
    v_nb,
    nullif(p_payload->>'annees_experience','')::int,
    nullif(p_payload->>'assurance_rc_pro','')::boolean,
    nullif(p_payload->>'assurance_decennale','')::boolean
  ) returning id, token into v_id, v_token;

  v_contrat := public.ensure_engagement_contrat(v_id);

  return json_build_object('ok', true, 'id', v_id, 'contrat_token', v_contrat.token,
                           'espace_token', v_token, 'taux_commission', v_lien.taux::numeric / 100, 'email', nullif(trim(p_payload->>'email'),''));
end;
$$;
grant execute on function public.inscrire_artisan(jsonb) to anon, authenticated;

revoke all on function public.inscrire_artisan(jsonb) from public;
grant execute on function public.inscrire_artisan(jsonb) to anon, authenticated;
