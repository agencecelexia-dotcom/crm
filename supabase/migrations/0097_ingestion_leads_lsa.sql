-- Entrée automatique des leads Google Local Services Ads.
--
-- Objectif : ne plus ressaisir à la main un numéro déjà reçu par LSA. Le lead
-- arrive, la fiche se crée, l'agence n'a plus qu'à qualifier et attribuer.
--
-- Google LSA n'émet AUCUN webhook : la seule voie temps réel est l'email de
-- notification que Google envoie à chaque lead. n8n lit la boîte, extrait les
-- informations et appelle cette fonction.
--
-- Deux garde-fous, parce qu'un flux automatique ne se surveille pas :
--   • idempotence sur `source_ref` — un même lead LSA rejoué (relance n8n,
--     doublon d'email) ne crée pas deux fiches ;
--   • repli sur le téléphone — si Google ne fournit pas d'identifiant, on
--     dédoublonne sur le numéro dans une fenêtre de 30 jours. Un même client
--     qui redemande un devis six mois plus tard est un nouveau lead ; le même
--     numéro deux fois dans la journée est un doublon.

alter table public.projets add column if not exists source text;
alter table public.projets add column if not exists source_ref text;

comment on column public.projets.source is
  'Provenance du lead : « lsa » (Google Local Services), « plateforme », « appel », null si saisie manuelle.';
comment on column public.projets.source_ref is
  'Identifiant du lead chez la source. Sert à l''idempotence : un lead rejoué ne crée pas de doublon.';

-- Contrainte partielle : deux leads sans référence ne se gênent pas, mais une
-- même référence ne peut entrer qu'une fois.
create unique index if not exists idx_projets_source_ref
  on public.projets (source, source_ref)
  where source_ref is not null;

create index if not exists idx_projets_source on public.projets (source)
  where source is not null;

/**
 * Crée un lead venu d'une source externe, sans jamais dupliquer.
 *
 * Renvoie toujours l'identifiant du projet — créé ou déjà existant — pour que
 * l'appelant n'ait pas à distinguer les deux cas.
 */
create or replace function public.ingerer_lead_externe(p_lead jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source     text := coalesce(nullif(btrim(p_lead->>'source'), ''), 'externe');
  v_ref        text := nullif(btrim(p_lead->>'source_ref'), '');
  v_tel        text := regexp_replace(coalesce(p_lead->>'telephone', ''), '\D', '', 'g');
  v_nom        text := nullif(btrim(p_lead->>'nom'), '');
  v_metier     text := nullif(btrim(p_lead->>'metier'), '');
  v_id         uuid;
  v_existant   uuid;
begin
  -- Un numéro français a 10 chiffres. Les formats internationaux (+33…)
  -- arrivent parfois sur 11 ou 12 : on les ramène au format national.
  if length(v_tel) = 11 and left(v_tel, 2) = '33' then
    v_tel := '0' || substring(v_tel from 3);
  elsif length(v_tel) = 12 and left(v_tel, 3) = '033' then
    v_tel := '0' || substring(v_tel from 4);
  end if;
  if length(v_tel) <> 10 then v_tel := null; end if;

  -- 1. Idempotence stricte : même source, même référence.
  if v_ref is not null then
    select id into v_existant
      from public.projets
     where source = v_source and source_ref = v_ref
     limit 1;
    if v_existant is not null then
      return json_build_object('ok', true, 'projet_id', v_existant, 'cree', false,
                               'raison', 'reference_deja_vue');
    end if;
  end if;

  -- 2. Repli : même numéro reçu récemment. Au-delà de 30 jours, un client qui
  --    recontacte est une nouvelle demande, pas un doublon.
  if v_tel is not null then
    select id into v_existant
      from public.projets
     where deleted_at is null
       and regexp_replace(coalesce(client_telephone, ''), '\D', '', 'g') = v_tel
       and created_at > now() - interval '30 days'
     order by created_at desc
     limit 1;
    if v_existant is not null then
      return json_build_object('ok', true, 'projet_id', v_existant, 'cree', false,
                               'raison', 'telephone_deja_present');
    end if;
  end if;

  -- Sans téléphone ni nom, la fiche serait inexploitable : autant le signaler
  -- que de créer un dossier vide que personne ne pourra traiter.
  if v_tel is null and v_nom is null then
    return json_build_object('ok', false, 'error', 'ni_telephone_ni_nom');
  end if;

  insert into public.projets (
    client_nom, client_telephone, client_email,
    client_adresse, client_ville, client_code_postal,
    metier, metiers, statut, description, source, source_ref
  ) values (
    coalesce(v_nom, v_tel, 'À qualifier'),
    v_tel,
    nullif(btrim(p_lead->>'email'), ''),
    nullif(btrim(p_lead->>'adresse'), ''),
    nullif(btrim(p_lead->>'ville'), ''),
    nullif(btrim(p_lead->>'code_postal'), ''),
    coalesce(v_metier, 'Rénovation'),
    array[coalesce(v_metier, 'Rénovation')],
    -- « nouveau » et non « a_rappeler » : le lead n'a pas encore été appelé,
    -- il entre dans le flux normal de qualification.
    'nouveau',
    nullif(btrim(p_lead->>'description'), ''),
    v_source,
    v_ref
  )
  returning id into v_id;

  return json_build_object('ok', true, 'projet_id', v_id, 'cree', true);
end;
$$;

comment on function public.ingerer_lead_externe(jsonb) is
  'Crée un lead venu d''une source externe (LSA, plateforme) sans doublon. Idempotent sur source_ref, avec repli sur le téléphone à 30 jours.';

-- Réservée au service_role : c'est n8n qui appelle, jamais un navigateur.
revoke execute on function public.ingerer_lead_externe(jsonb) from public, anon, authenticated;
grant execute on function public.ingerer_lead_externe(jsonb) to service_role;
