-- ============================================================
--  0066 — Storage : couper l'énumération et l'écriture anonyme (A1-01, A1-07).
--
--  Exploitation confirmée en production avant correctif, avec la seule clé
--  publiable (celle qui est servie dans le bundle JS, donc connue de tous) :
--    POST /storage/v1/object/list/devis         → liste des devis PDF
--    POST /storage/v1/object/list/projet-photos → liste des photos de chantier
--  Et, pour le bucket `devis`, les policies accordaient à `anon` INSERT,
--  UPDATE et DELETE avec pour seul prédicat `bucket_id = 'devis'` : n'importe
--  qui pouvait écraser ou SUPPRIMER l'intégralité des devis signés.
--
--  Décision : les buckets restent `public = true`.
--  Les passer en privé imposerait des URLs signées, or l'artisan accède en
--  tant que `anon` et ne peut pas en générer ; il faudrait les fabriquer dans
--  get_espace_artisan / get_mission_by_token, ce que PostgreSQL ne sait pas
--  faire. Et les 57 URLs publiques déjà stockées en base cesseraient de
--  fonctionner. Ce chantier est réel mais plus large — voir la note en fin de
--  fichier.
--
--  Ce que cette migration ferme, et qui est l'essentiel du risque :
--    1. l'ÉNUMÉRATION (retrait de la policy SELECT ouverte à PUBLIC) : sans
--       elle, il faut deviner un chemin de 32 caractères hexadécimaux ;
--    2. l'ÉCRITURE et la SUPPRESSION anonymes non ciblées sur `devis`.
--
--  Modèle de sécurité résultant : identique à celui des liens à token du
--  reste de l'application — une URL non devinable vaut capacité d'accès.
-- ============================================================

-- ---------- Bucket `devis` ----------
drop policy if exists "devis_read"   on storage.objects;
drop policy if exists "devis_write"  on storage.objects;
drop policy if exists "devis_update" on storage.objects;
drop policy if exists "devis_delete" on storage.objects;

-- Lecture via l'API : réservée aux associés. (L'accès par URL directe reste
-- possible puisque le bucket est public — c'est voulu, l'artisan en a besoin.)
create policy "devis_list_auth" on storage.objects
  for select to authenticated using (bucket_id = 'devis');

-- Dépôt anonyme : UNIQUEMENT sous un préfixe correspondant à un token
-- d'affectation existant. `uploaderDevis` écrit déjà sous `${token}/...`
-- (src/lib/storage.ts:46), le format est donc respecté sans changement front.
create policy "devis_insert_token" on storage.objects
  for insert to anon with check (
    bucket_id = 'devis'
    and exists (
      select 1 from public.affectations a
       where a.token = split_part(name, '/', 1)
         and a.retire_at is null
    )
  );

-- Les associés gardent la main complète.
create policy "devis_insert_auth" on storage.objects
  for insert to authenticated with check (bucket_id = 'devis');
create policy "devis_update_auth" on storage.objects
  for update to authenticated using (bucket_id = 'devis');
create policy "devis_delete_auth" on storage.objects
  for delete to authenticated using (bucket_id = 'devis');
-- Ni UPDATE ni DELETE pour anon : le dépôt est append-only côté artisan.

-- ---------- Bucket `projet-photos` ----------
-- La policy de lecture n'avait pas de clause `to`, elle s'appliquait donc au
-- rôle PUBLIC. L'écriture et la suppression étaient déjà correctement
-- réservées à `authenticated` : seule l'énumération était ouverte.
drop policy if exists "photos_read" on storage.objects;

create policy "photos_list_auth" on storage.objects
  for select to authenticated using (bucket_id = 'projet-photos');

-- ---------- Reste à faire (hors périmètre de cette migration) ----------
-- Pour une confidentialité complète des devis et photos, il faudrait :
--   1. passer les deux buckets en `public = false` ;
--   2. générer les URLs signées côté serveur et les renvoyer dans
--      get_espace_artisan et get_mission_by_token (edge function, PostgreSQL
--      ne sachant pas signer) ;
--   3. migrer les 57 URLs publiques déjà stockées vers des chemins.
-- Tant que ce n'est pas fait, la confidentialité repose sur le caractère non
-- devinable des chemins — le même modèle que les liens à token du produit.
