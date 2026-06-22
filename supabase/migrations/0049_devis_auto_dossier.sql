-- 0049 — Rattachement AUTOMATIQUE d'un devis au bon dossier.
-- Avant : un devis n'était lié à un projet que s'il était créé depuis ce projet
-- (affectation_token). Un « Nouveau devis » standalone restait orphelin.
-- Maintenant : si pas de token, on matche le client du devis (téléphone d'abord,
-- puis nom) à une affectation de cet artisan → le devis tombe sur le bon dossier.

create or replace function public.creer_devis_by_token(p_token text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare a public.artisans; af public.affectations; v_num text; v_id uuid;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false, 'error', 'non autorisé'); end if;

  -- 1) Rattachement explicite (devis créé depuis un projet)
  if coalesce(p_payload->>'affectation_token','') <> '' then
    select * into af from public.affectations
      where token = p_payload->>'affectation_token' and artisan_id = a.id;
  end if;

  -- 2) Sinon : rattachement AUTO au bon dossier via le client (téléphone puis nom)
  if af.id is null then
    select af3.* into af
    from public.affectations af3
    join public.projets p3 on p3.id = af3.projet_id
    where af3.artisan_id = a.id
      and af3.statut <> 'perdu'
      and p3.deleted_at is null
      and (
        (nullif(regexp_replace(coalesce(p_payload->>'client_tel',''), '\D', '', 'g'), '') is not null
          and regexp_replace(coalesce(p3.client_telephone,''), '\D', '', 'g')
              = regexp_replace(p_payload->>'client_tel', '\D', '', 'g'))
        or (nullif(trim(p_payload->>'client_nom'), '') is not null
          and lower(trim(p3.client_nom)) = lower(trim(p_payload->>'client_nom')))
      )
    order by af3.created_at desc
    limit 1;
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

  return json_build_object('ok', true, 'id', v_id, 'numero', v_num, 'projet_id', af.projet_id);
end;
$$;
grant execute on function public.creer_devis_by_token(text, jsonb) to anon, authenticated;
