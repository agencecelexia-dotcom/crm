-- La maison en 3D, vue de l'agence : depuis la fiche du client, ou d'une
-- simple adresse.
--
-- Le relevé, les photos de façade et le matériau du toit étaient réservés au
-- jeton de l'artisan. Un membre actif de l'agence y accède maintenant par sa
-- session (`_membre.ts`) : les fonctions `batiment-chantier`, `releve-lidar`
-- et `facade-photo` vérifient qui appelle, comme `transcrire-audio`.
--
-- Une photo lue ou déposée par un membre garde son auteur à part : les
-- colonnes existantes pointent vers la table des artisans. Le quota de
-- lectures (quelques centimes chacune) se compte aussi par membre.

alter table public.facade_photo
  add column if not exists lu_par_membre uuid references auth.users (id) on delete set null,
  add column if not exists deposee_par_membre uuid references auth.users (id) on delete set null;

create index if not exists facade_photo_quota_membre on public.facade_photo (lu_par_membre, lu_le);
