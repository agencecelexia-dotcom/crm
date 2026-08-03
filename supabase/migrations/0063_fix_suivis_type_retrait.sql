-- ============================================================
--  0063 — Correctif : autoriser le type de suivi 'retrait'.
--
--  Bug introduit par 0061 : retirer_chantier_by_token() insère un suivi avec
--  type = 'retrait', alors que la contrainte suivis_type_check n'autorisait
--  que ('statut', 'note', 'appel'). Tout retrait échouait donc sur un
--  23514 check_violation, remonté à l'artisan en « Retrait impossible ».
--
--  Pourquoi étendre la contrainte plutôt que réutiliser 'statut' :
--  un retrait volontaire de l'artisan n'est pas la même chose qu'un « perdu »
--  déclaré parce que le client a dit non. Garder la distinction dans les
--  données permet, plus tard, d'exclure les retraits volontaires du scoring
--  artisan (0059) sans avoir à deviner l'intention a posteriori.
-- ============================================================

alter table public.suivis drop constraint if exists suivis_type_check;

alter table public.suivis add constraint suivis_type_check
  check (type = any (array['statut'::text, 'note'::text, 'appel'::text, 'retrait'::text]));

comment on constraint suivis_type_check on public.suivis is
  'statut = changement d''étape · note = commentaire libre · appel = trace d''appel · '
  'retrait = l''artisan s''est retiré volontairement du chantier (0061).';
