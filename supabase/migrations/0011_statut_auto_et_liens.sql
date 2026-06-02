-- ============================================================
--  0011 — Statut auto sur dépôt de devis + lien CRM dans les notifs
-- ============================================================

-- ---------- 1) Statut automatique quand un devis est déposé ----------
-- Devis déposé (devis_url) → "devis_envoye" ; devis signé déposé (devis_signe_url) → "devis_signe".
-- Ne rétrograde jamais un statut plus avancé ; ignore les projets "perdu".
create or replace function public.auto_statut_sur_devis()
returns trigger
language plpgsql
as $$
begin
  if new.devis_signe_url is not null and old.devis_signe_url is null then
    if new.statut <> 'perdu' then new.statut := 'devis_signe'; end if;
  elsif new.devis_url is not null and old.devis_url is null then
    if new.statut in ('nouveau', 'artisan_assigne') then new.statut := 'devis_envoye'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_statut_devis on public.projets;
create trigger trg_auto_statut_devis
  before update on public.projets
  for each row execute function public.auto_statut_sur_devis();

-- ---------- 2) Lien CRM direct dans les emails internes ----------
-- Contrat signé → lien vers la fiche artisan.
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
        'signataire', new.signataire_nom,
        'lien', 'https://crm-ci7k.vercel.app/artisans/' || new.artisan_id
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

-- Devis / devis signé déposé → lien vers la fiche projet.
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
      'societe', a.societe,
      'lien', 'https://crm-ci7k.vercel.app/projets/' || new.id
    ),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
end;
$$;
