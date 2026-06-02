-- ============================================================
--  0001 — Schéma initial CRM Celexia
--  2 tables : artisans + projets. Règle métier : 1 projet = 1 artisan.
-- ============================================================

-- ---------- Table artisans ----------
create table if not exists public.artisans (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  prenom text,
  societe text,
  telephone text,
  email text,
  metiers text[] not null default '{}',      -- ex : {clôture, paysagisme}
  zone_intervention text,
  rayon_km integer,
  adresse text,
  ville text,
  code_postal text,
  latitude double precision,
  longitude double precision,
  specificites text,                          -- ce qu'il fait exactement, qualités, notes
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- Table projets (= un appel client = un projet) ----------
create table if not exists public.projets (
  id uuid primary key default gen_random_uuid(),

  -- Client (saisi pendant l'appel)
  client_nom text not null,
  client_telephone text,
  client_email text,
  client_adresse text,
  client_ville text,
  client_code_postal text,
  latitude double precision,
  longitude double precision,

  -- Demande
  metier text not null,
  description text,
  budget_estime numeric,

  -- Attribution (1 artisan max)
  artisan_id uuid references public.artisans(id) on delete set null,

  -- Pipeline
  statut text not null default 'nouveau'
    check (statut in ('nouveau','artisan_assigne','devis_envoye','devis_signe','perdu')),

  -- Argent
  montant_devis numeric,
  montant_devis_signe numeric,
  -- Commission = 10 % du devis signé, calculée par la base (jamais côté front)
  commission numeric generated always as (coalesce(montant_devis_signe, 0) * 0.10) stored,
  commission_encaissee boolean default false,
  date_signature date,

  -- Fichiers (Supabase Storage, bucket privé "documents")
  contrat_url text,
  devis_url text,
  devis_signe_url text,

  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index utiles pour les filtres fréquents (statut, métier, artisan)
create index if not exists idx_projets_statut on public.projets (statut);
create index if not exists idx_projets_metier on public.projets (metier);
create index if not exists idx_projets_artisan on public.projets (artisan_id);
create index if not exists idx_artisans_metiers on public.artisans using gin (metiers);
