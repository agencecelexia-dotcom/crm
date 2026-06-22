-- 0052 — Profil artisan enrichi (auto-inscription) : salariés, expérience, assurances.
-- + inscrire_artisan : forme=EI si 0 salarié, stocke le profil, renvoie token d'espace + email.

alter table public.artisans add column if not exists nb_salaries int;
alter table public.artisans add column if not exists annees_experience int;
alter table public.artisans add column if not exists assurance_rc_pro boolean;
alter table public.artisans add column if not exists assurance_decennale boolean;

create or replace function public.inscrire_artisan(p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_token text; v_source text; v_contrat public.contrats; v_nb int; v_forme text;
begin
  if coalesce(trim(p_payload->>'nom'),'') = '' and coalesce(trim(p_payload->>'societe'),'') = '' then
    return json_build_object('ok', false, 'error', 'Nom ou société requis');
  end if;
  v_source := coalesce(nullif(trim(p_payload->>'source'),''), 'auto-inscription');
  v_nb := nullif(p_payload->>'nb_salaries','')::int;
  -- 0 salarié → Entreprise Individuelle (sauf forme déjà renseignée)
  v_forme := coalesce(nullif(trim(p_payload->>'forme_juridique'),''),
                      case when v_nb = 0 then 'EI' else null end);

  insert into public.artisans (
    nom, prenom, societe, telephone, email,
    metiers, sous_metiers, rayon_km, departements_couverts,
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
    coalesce(nullif(p_payload->>'taux_commission','')::numeric, 0.10),
    nullif(trim(p_payload->>'specificites'),''),
    v_source,
    v_nb,
    nullif(p_payload->>'annees_experience','')::int,
    nullif(p_payload->>'assurance_rc_pro','')::boolean,
    nullif(p_payload->>'assurance_decennale','')::boolean
  ) returning id, token into v_id, v_token;

  v_contrat := public.ensure_engagement_contrat(v_id);

  return json_build_object('ok', true, 'id', v_id, 'contrat_token', v_contrat.token,
                           'espace_token', v_token, 'email', nullif(trim(p_payload->>'email'),''));
end;
$$;
grant execute on function public.inscrire_artisan(jsonb) to anon, authenticated;
