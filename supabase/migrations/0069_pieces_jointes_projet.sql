-- ============================================================
--  0069 — Pièces jointes libres sur un projet.
--
--  Existant : la carte « Documents (PDF) » d'une fiche projet expose trois
--  emplacements FIXES — contrat d'engagement, devis, devis signé — stockés
--  dans les colonnes projets.contrat_url / devis_url / devis_signe_url.
--  Un seul fichier par emplacement, un nouveau dépôt écrase le précédent.
--
--  Besoin : pouvoir joindre autant de PDF que nécessaire à un projet (photos
--  de plans, courriers, attestations, factures…) sans écraser quoi que ce soit.
--
--  Choix : une table dédiée plutôt que de nouvelles colonnes. Les trois
--  emplacements fixes gardent leur sémantique (ils pilotent le trigger
--  auto_statut_sur_devis) ; les pièces libres vivent à côté, sans effet de
--  bord sur la machine à états.
--
--  Stockage : bucket PRIVÉ `documents`, consultation par URL signée 1 h.
--  C'est le seul des trois buckets qui était correctement configuré à l'audit
--  (A1-01/A1-07 concernaient `devis` et `projet-photos`) : on s'y aligne,
--  plutôt que d'ouvrir un nouveau bucket public.
--
--  On stocke le CHEMIN, jamais une URL : une URL signée expire, et une URL
--  publique n'a pas lieu d'être ici.
-- ============================================================

create table if not exists public.projet_documents (
  id            uuid primary key default gen_random_uuid(),
  projet_id     uuid not null references public.projets(id) on delete cascade,
  nom           text not null,                 -- nom d'origine, affiché tel quel
  chemin        text not null,                 -- chemin dans le bucket `documents`
  taille_octets bigint,
  created_at    timestamptz not null default now()
);

create index if not exists idx_projet_documents_projet
  on public.projet_documents (projet_id, created_at desc);

alter table public.projet_documents enable row level security;

-- Même modèle que les autres tables métier : les 2 associés, pas d'accès anon.
-- Les pièces jointes ne sont PAS exposées à l'artisan : sa vue passe par
-- get_espace_artisan, qui ne lit pas cette table.
drop policy if exists "projet_documents_auth_all" on public.projet_documents;
create policy "projet_documents_auth_all" on public.projet_documents
  for all to authenticated using (true) with check (true);

comment on table public.projet_documents is
  'Pièces jointes libres d''un projet (PDF). Le fichier vit dans le bucket privé '
  '`documents` sous <projet_id>/pieces/<uuid>.pdf ; seul le chemin est stocké ici. '
  'La suppression de l''objet de stockage est faite par l''application AVANT la '
  'suppression de la ligne — le ON DELETE CASCADE d''un projet ne nettoie que la '
  'table, pas le bucket.';
