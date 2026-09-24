-- Les artisans ne pouvaient plus déposer aucun fichier depuis le 2 septembre.
--
-- La 0125 a déclaré les politiques du bucket `creatives` pour le rôle PUBLIC,
-- en appelant `est_fondateur()`. Or `anon` n'a pas le droit d'exécuter cette
-- fonction, et Postgres vérifie ce droit pour TOUTES les politiques applicables
-- à une ligne avant d'en évaluer une seule. Chaque dépôt anonyme, quel que soit
-- le bucket, échouait donc sur « permission denied for function est_fondateur »
-- — y compris ceux que `devis_insert_token`, `devis_logo_token` et
-- `documents_assurance_token` autorisaient parfaitement.
--
-- Conséquence : depuis la 0125, plus aucun devis PDF, logo ni attestation
-- d'assurance déposé depuis l'espace artisan. Le dernier dépôt anonyme date du
-- 31 août ; les 136 précédents s'étalaient régulièrement jusque-là.
--
-- Le bucket `creatives` ne sert qu'au fondateur, connecté : ses politiques n'ont
-- rien à faire dans l'évaluation d'une requête anonyme.

drop policy if exists creatives_bucket_ecriture on storage.objects;
create policy creatives_bucket_ecriture on storage.objects
  for all to authenticated
  using (bucket_id = 'creatives' and public.est_fondateur())
  with check (bucket_id = 'creatives' and public.est_fondateur());

drop policy if exists creatives_bucket_lecture on storage.objects;
create policy creatives_bucket_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'creatives' and public.est_fondateur());
