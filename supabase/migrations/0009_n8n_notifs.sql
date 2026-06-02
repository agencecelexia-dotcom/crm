-- ============================================================
--  0009 — Notifications n8n (essentielles)
--  Deux événements déclenchés par l'artisan (donc invisibles dans le CRM)
--  POSTent vers le webhook n8n, qui envoie un email aux 2 associés :
--    1) contrat d'engagement signé
--    2) devis (ou devis signé) déposé par l'artisan
--  Utilise pg_net (net.http_post). URL = webhook n8n du nouveau CRM.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- URL du webhook n8n (workflow "CRM Celexia — Notifications")
-- https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events

-- ---------- 1) Contrat d'engagement signé ----------
create or replace function public.notif_contrat_signe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare a public.artisans;
begin
  if new.statut = 'signe' and old.statut is distinct from 'signe' then
    select * into a from public.artisans where id = new.artisan_id;
    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'contrat_signe',
        'artisan', trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')),
        'societe', a.societe,
        'signataire', new.signataire_nom
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_contrat_signe on public.contrats;
create trigger trg_notif_contrat_signe
  after update on public.contrats
  for each row execute function public.notif_contrat_signe();

-- ---------- 2) Devis / devis signé déposé par l'artisan ----------
create or replace function public.notif_devis_depose()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare a public.artisans; v_type text;
begin
  if new.devis_signe_url is distinct from old.devis_signe_url and new.devis_signe_url is not null then
    v_type := 'devis_signe';
  elsif new.devis_url is distinct from old.devis_url and new.devis_url is not null then
    v_type := 'devis';
  else
    return new;
  end if;

  select * into a from public.artisans where id = new.artisan_id;
  perform net.http_post(
    url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
    body := jsonb_build_object(
      'event', 'devis_depose',
      'type', v_type,
      'client_nom', new.client_nom,
      'metier', new.metier,
      'client_ville', new.client_ville,
      'artisan', trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')),
      'societe', a.societe
    ),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists trg_notif_devis_depose on public.projets;
create trigger trg_notif_devis_depose
  after update on public.projets
  for each row execute function public.notif_devis_depose();
