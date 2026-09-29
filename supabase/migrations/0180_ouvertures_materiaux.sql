-- Les ouvertures que l'artisan retire, les matériaux lus, et l'interrupteur
-- de la lecture des matériaux par la pré-mesure.
--
-- LES OUVERTURES RETIRÉES
--
-- La vision prend parfois un reflet, une grille ou la fenêtre du voisin pour
-- une ouverture. L'artisan la retire d'un appui (dans la vue 3D) : son rang
-- dans la lecture est gardé avec la photo, et la surface se recalcule sans
-- elle — à l'écran comme au dossier. La lecture elle-même ne change pas.
--
-- LES MATÉRIAUX
--
-- Le matériau du toit, lu par Claude sur la photo aérienne de l'IGN (5 cm là
-- où elle existe, 20 cm ailleurs), rattaché au bâtiment comme son relevé :
-- une lecture par maison, pour tous ses chantiers.
--
-- L'INTERRUPTEUR
--
-- La pré-mesure peut lire ce matériau avant que l'artisan n'ouvre sa fiche.
-- La lecture coûte quelques centimes : elle a son propre interrupteur,
-- « auto_materiaux », dans Paramètres › Automatisations, relu par la tâche.

alter table public.facade_photo
  add column if not exists ecartees smallint[] not null default '{}';

alter table public.releve_batiment
  add column if not exists materiaux jsonb,
  add column if not exists materiaux_le timestamptz;

insert into public.app_settings (cle, valeur) values ('auto_materiaux', 'on')
on conflict (cle) do nothing;
