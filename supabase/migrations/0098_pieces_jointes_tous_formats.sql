-- ============================================================
--  0098 — Pièces jointes : tous formats, et visibles par l'artisan.
--
--  Existant (0069) : `projet_documents` accepte des pièces libres, mais le
--  front les filtrait sur le PDF et la table n'était lue par personne d'autre
--  que l'agence — le commentaire de 0069 le disait explicitement :
--  « Les pièces jointes ne sont PAS exposées à l'artisan ».
--
--  Besoin métier : un client qui a déjà fait chiffrer son chantier nous envoie
--  son devis (PDF), des photos, parfois une vidéo de la pièce à rénover. Tout
--  cela doit arriver jusqu'à l'artisan, sur SON dossier — c'est précisément ce
--  qui lui permet de chiffrer sans se déplacer.
--
--  Ce que fait cette migration :
--    1. `type_mime` sur la table — pour servir le bon Content-Type et choisir
--       l'affichage (aperçu image, lecteur vidéo, icône fichier).
--    2. `visible_artisan` — TOUTE pièce n'a pas vocation à être transmise
--       (un relevé de commission, une note interne scannée…). Défaut à `true`,
--       car le cas courant est bien de partager ; l'agence peut décocher.
--    3. Un flux de lecture pour l'artisan, qui accède en `anon` par token.
--
--  Sur le point 3 — pourquoi pas dans get_espace_artisan :
--  le bucket `documents` est PRIVÉ et le restera (les devis de nos clients
--  n'ont rien à faire derrière une URL publique éternelle). L'accès demande
--  donc une URL signée, que PostgreSQL ne sait pas fabriquer. C'est le
--  « reste à faire » identifié en fin de migration 0066.
--
--  On ne renvoie donc PAS les fichiers depuis get_espace_artisan. On expose
--  seulement `documents_projet_par_token`, qui liste les MÉTADONNÉES (nom,
--  type, taille) sans aucun chemin de stockage ; l'edge function
--  `document-signe` échange ensuite un couple (token, id de pièce) contre une
--  URL signée d'une heure. Le chemin de stockage ne quitte jamais le serveur,
--  et une URL qui fuite expire.
-- ============================================================

-- ---------- 1. Colonnes ----------

alter table public.projet_documents
  add column if not exists type_mime       text,
  add column if not exists visible_artisan boolean not null default true;

comment on column public.projet_documents.type_mime is
  'Type MIME d''origine (application/pdf, image/jpeg, video/mp4…). Sert à '
  'choisir le rendu côté client et le Content-Type à la signature. Peut être '
  'null sur les lignes antérieures à 0098 — toutes des PDF.';

comment on column public.projet_documents.visible_artisan is
  'Si vrai, la pièce est transmise à l''artisan affecté au projet. Défaut vrai : '
  'le cas courant est de partager (devis client, photos, vidéos du chantier). '
  'À décocher pour ce qui reste interne à l''agence.';

-- Les pièces déposées avant 0098 étaient toutes des PDF, par construction :
-- le front n'acceptait que ce format.
update public.projet_documents
   set type_mime = 'application/pdf'
 where type_mime is null;

-- ---------- 2. Plafond de taille du bucket ----------

-- Le bucket héritait jusqu'ici du plafond global du projet. On le fixe
-- explicitement à 200 Mo : de quoi accueillir une vidéo de chantier de 2-3
-- minutes filmée au téléphone, sans laisser passer n'importe quoi.
--
-- ATTENTION : le plan Supabase impose son propre plafond par fichier (50 Mo
-- sur le plan gratuit). Cette valeur ne peut pas le dépasser — si les uploads
-- de plus de 50 Mo échouent en production malgré cette ligne, c'est le plan
-- qu'il faut regarder, pas cette migration.
update storage.buckets
   set file_size_limit = 200 * 1024 * 1024
 where id = 'documents';

-- ---------- 3. Lecture par l'artisan : métadonnées uniquement ----------

-- Renvoie les pièces partagées d'un projet, à partir d'un token d'AFFECTATION.
-- On passe par l'affectation et non par le projet : c'est le lien qui prouve
-- que CET artisan travaille sur CE chantier. Une affectation retirée ne donne
-- plus rien, comme partout ailleurs dans le produit.
--
-- Aucun `chemin` dans la sortie : la pièce se récupère ensuite via l'edge
-- function `document-signe`, seule habilitée à voir le chemin réel.
create or replace function public.documents_projet_par_token(p_token text)
returns json
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(
    json_agg(
      json_build_object(
        'id', d.id,
        'nom', d.nom,
        'type_mime', d.type_mime,
        'taille_octets', d.taille_octets,
        'created_at', d.created_at
      ) order by d.created_at desc
    ),
    '[]'::json
  )
  from public.affectations af
  join public.projets p         on p.id = af.projet_id
  join public.projet_documents d on d.projet_id = p.id
  where af.token = p_token
    and af.retire_at is null
    and p.deleted_at is null
    and d.visible_artisan;
$$;

revoke execute on function public.documents_projet_par_token(text) from public;
grant  execute on function public.documents_projet_par_token(text) to anon, authenticated;

comment on function public.documents_projet_par_token(text) is
  'Pièces jointes partagées d''un chantier, pour l''espace artisan (accès anon '
  'par token d''affectation). Ne renvoie AUCUN chemin de stockage : l''URL de '
  'consultation est délivrée, signée et temporaire, par l''edge function '
  '`document-signe`.';
