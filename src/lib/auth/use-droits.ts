import { useAuth } from './use-auth'

/**
 * Droits du compte connecté.
 *
 * Le cloisonnement réel est appliqué par la RLS (migration 0112) : ces valeurs
 * ne servent qu'à MASQUER ce qui serait de toute façon refusé. Sans ce
 * masquage, la personne remplit un formulaire puis se prend une erreur
 * incompréhensible — c'était exactement le cas de `peut_creer_artisan`.
 *
 * L'inverse est vrai aussi : masquer sans bloquer en base serait cosmétique,
 * une URL tapée à la main suffirait à contourner.
 */
export function useDroits() {
  const { membre, estFondateur } = useAuth()

  // Un fondateur a tous les droits, sans exception. C'est ce qui garantit
  // qu'on ne peut pas se verrouiller hors de son propre CRM.
  if (estFondateur) {
    return {
      peutCreerLead: true,
      peutAttribuer: true,
      peutCreerArtisan: true,
      peutVoirCommissions: true,
    }
  }

  // Compte sans fiche membre, ou désactivé : périmètre le plus restreint.
  // Le défaut n'est jamais permissif.
  const actif = Boolean(membre?.actif)

  return {
    peutCreerLead: actif && Boolean(membre?.peut_creer_lead),
    peutAttribuer: actif && Boolean(membre?.peut_attribuer),
    peutCreerArtisan: actif && Boolean(membre?.peut_creer_artisan),
    peutVoirCommissions: actif && Boolean(membre?.peut_voir_commissions),
  }
}
