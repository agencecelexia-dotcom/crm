-- 0050 — Auto-inscription artisan via lien public externe (WhatsApp/Facebook…).
-- L'artisan remplit lui-même la même fiche que « Nouvel artisan » et est créé
-- directement dans le CRM, tagué avec sa source (canal). RPC anon security-definer.

alter table public.artisans add column if not exists source text; -- ex: agence | auto:facebook | auto:whatsapp
create index if not exists idx_artisans_source on public.artisans (source);

create or replace function public.inscrire_artisan(p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_source text;
begin
  -- garde-fou minimal : un nom OU une société
  if coalesce(trim(p_payload->>'nom'),'') = '' and coalesce(trim(p_payload->>'societe'),'') = '' then
    return json_build_object('ok', false, 'error', 'Nom ou société requis');
  end if;
  v_source := coalesce(nullif(trim(p_payload->>'source'),''), 'auto-inscription');

  insert into public.artisans (
    nom, prenom, societe, telephone, email,
    metiers, sous_metiers, rayon_km, departements_couverts,
    adresse, ville, code_postal, latitude, longitude,
    forme_juridique, capital_social, siren, ville_immatriculation,
    representant, qualite_representant, taux_commission, specificites, source
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
    nullif(trim(p_payload->>'forme_juridique'),''),
    nullif(trim(p_payload->>'capital_social'),''),
    nullif(trim(p_payload->>'siren'),''),
    nullif(trim(p_payload->>'ville_immatriculation'),''),
    nullif(trim(p_payload->>'representant'),''),
    nullif(trim(p_payload->>'qualite_representant'),''),
    coalesce(nullif(p_payload->>'taux_commission','')::numeric, 0.10),
    nullif(trim(p_payload->>'specificites'),''),
    v_source
  ) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;
grant execute on function public.inscrire_artisan(jsonb) to anon, authenticated;
