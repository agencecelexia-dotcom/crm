-- ============================================================
--  0006 — Contrats d'engagement artisan + signature en ligne
--  La signature se fait sur une page PUBLIQUE (sans login), accessible
--  uniquement via un token secret. L'anonyme n'accède jamais directement
--  à la table : il passe par 2 fonctions SECURITY DEFINER limitées au token.
-- ============================================================

create table if not exists public.contrats (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  type text not null default 'engagement',
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  contenu text not null,                 -- snapshot du texte du contrat à l'envoi
  statut text not null default 'envoye'
    check (statut in ('envoye', 'signe')),
  signataire_nom text,
  signature_data text,                   -- image PNG (base64) de la signature
  signed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_contrats_artisan on public.contrats (artisan_id);

-- updated_at automatique (réutilise la fonction existante)
drop trigger if exists trg_contrats_updated_at on public.contrats;
create trigger trg_contrats_updated_at
  before update on public.contrats
  for each row execute function public.set_updated_at();

-- RLS : côté CRM, accès complet aux utilisateurs authentifiés. Aucun accès anon direct.
alter table public.contrats enable row level security;
drop policy if exists "contrats_authenticated_all" on public.contrats;
create policy "contrats_authenticated_all" on public.contrats
  for all to authenticated using (true) with check (true);

-- ---------- Fonctions publiques (token only) ----------

-- Lecture d'un contrat par son token (pour la page de signature publique).
create or replace function public.get_contrat_by_token(p_token text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'id', c.id,
    'type', c.type,
    'contenu', c.contenu,
    'statut', c.statut,
    'signataire_nom', c.signataire_nom,
    'signed_at', c.signed_at,
    'artisan', json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe)
  )
  from public.contrats c
  join public.artisans a on a.id = c.artisan_id
  where c.token = p_token;
$$;

-- Signature d'un contrat (depuis la page publique). Idempotent : refuse si déjà signé.
create or replace function public.signer_contrat(
  p_token text, p_signataire text, p_signature text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare r public.contrats;
begin
  update public.contrats
    set statut = 'signe',
        signataire_nom = p_signataire,
        signature_data = p_signature,
        signed_at = now()
    where token = p_token and statut <> 'signe'
    returning * into r;

  if r.id is null then
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true, 'signed_at', r.signed_at);
end;
$$;

-- Autorise l'appel de ces 2 fonctions par le rôle anonyme (et authentifié).
grant execute on function public.get_contrat_by_token(text) to anon, authenticated;
grant execute on function public.signer_contrat(text, text, text) to anon, authenticated;
