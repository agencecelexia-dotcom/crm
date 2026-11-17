-- 0201 — Site web de l'artisan.
--
-- Le formulaire /rejoindre demande « Votre entreprise a-t-elle un site web ? »
-- et exige l'adresse quand la réponse est oui. L'agence la voit, cliquable,
-- sur la fiche artisan (artisans et partenaires) et peut la corriger.
--
-- Le lien est affiché tel quel dans un <a href> : seule une adresse http(s)
-- avec un vrai nom de domaine est acceptée (jamais `javascript:`).
-- À APPLIQUER AVANT le front qui lit la colonne (liste explicite de colonnes).

alter table public.artisans add column if not exists site_web text;

-- « www.atelier.fr » → « https://www.atelier.fr » ; null si ce n'est pas une adresse web.
create or replace function public.normaliser_site_web(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when v is null then null
    when v ~* '^https?://[^\s/?#@:]+(\.[^\s/?#@:]+)+(:\d+)?([/?#]\S*)?$' then v
    else null
  end
  from (select case
                 when nullif(trim(p), '') is null then null
                 when trim(p) ~* '^https?://' then trim(p)
                 when trim(p) ~ '^[a-zA-Z][a-zA-Z0-9+.-]*:' then 'refus:'
                 else 'https://' || regexp_replace(trim(p), '^/+', '')
               end as v) s
$$;

-- Les fonctions naissent fermées (0129) ; la contrainte ci-dessous l'appelle
-- quand l'équipe crée ou corrige une fiche.
grant execute on function public.normaliser_site_web(text) to authenticated;

alter table public.artisans drop constraint if exists artisans_site_web_http;
alter table public.artisans add constraint artisans_site_web_http
  check (public.normaliser_site_web(site_web) is not distinct from site_web);

-- Lecture et correction par l'équipe, comme les autres coordonnées (0161).
grant select (site_web), update (site_web) on public.artisans to authenticated;

-- Inscription publique : identique à 0195, plus le site web.
create or replace function public.inscrire_artisan(p_payload jsonb)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_token text; v_source text; v_contrat public.contrats; v_nb int; v_forme text; v_lien public.liens_inscription_artisan;
  v_site text;
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
  v_site := public.normaliser_site_web(p_payload->>'site_web');
  if nullif(trim(p_payload->>'site_web'),'') is not null and v_site is null then
    return json_build_object('ok', false, 'error', 'L’adresse de votre site web n’est pas reconnue. Exemple : www.votre-entreprise.fr');
  end if;
  v_source := 'auto:' || v_lien.canal;
  v_nb := nullif(p_payload->>'nb_salaries','')::int;
  v_forme := coalesce(nullif(trim(p_payload->>'forme_juridique'),''),
                      case when v_nb = 0 then 'EI' else null end);

  insert into public.artisans (
    nom, prenom, societe, telephone, email, site_web,
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
    v_site,
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
