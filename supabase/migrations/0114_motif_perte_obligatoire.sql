-- Supprime la voie qui permettait de rendre un chantier sans motif.
--
-- Deux versions de `retirer_chantier_by_token` coexistaient :
--
--   * celle à 2 arguments (0077) — une raison libre, aucun motif ;
--   * celle à 4 arguments (0104) — motif dans une liste fermée, justification
--     écrite, et date de recontact.
--
-- Le front appelle déjà la seconde, mais la première restait accessible à
-- `anon` : n'importe quel appel direct à l'API pouvait retirer un chantier sans
-- rien expliquer. C'est ce qui explique les 44 retraits muets sur 64 — un
-- commercial qui reprend un tel dossier travaille à l'aveugle.
--
-- Note : la version conservée impose déjà motif ET justification (garde
-- `motif_requis` / `justification_requise`). Rien à durcir de ce côté, il
-- suffit de fermer la porte de derrière.

drop function if exists public.retirer_chantier_by_token(text, text);

comment on function public.retirer_chantier_by_token(text, text, text, date) is
  'Retrait d''un artisan de son chantier. Motif (liste fermée) et justification '
  'écrite obligatoires : sans eux, la reprise se ferait à l''aveugle. '
  'Le motif `signe_concurrent` bascule le projet en `mort` (trigger 0111).';
