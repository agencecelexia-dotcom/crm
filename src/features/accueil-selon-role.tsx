import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth/use-auth'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { DashboardCommercial } from '@/features/commercial/dashboard-commercial'

/**
 * Accueil, selon le rôle.
 *
 * Le fondateur pilote l'agence : volume, CA, commissions, artisans. Le
 * commercial travaille ses leads : ce qu'il a à placer, ce qu'il a à reprendre,
 * ce qu'il a gagné. Deux métiers, deux écrans — servir le même à tout le monde
 * obligerait chacun à ignorer la moitié de la page.
 */
export function AccueilSelonRole() {
  const { estFondateur } = useAuth()
  const { hash } = useLocation()

  // Un lien de récupération peut retomber sur la racine plutôt que sur
  // /bienvenue (redirection tronquée, ou lien déjà ouvert par un scanner de
  // messagerie). Le type est alors dans le fragment d'URL : on redirige vers
  // le choix du mot de passe, sinon la personne verrait un tableau de bord
  // sans jamais pouvoir définir ses identifiants.
  if (hash.includes('type=recovery') || hash.includes('type=invite')) {
    return <Navigate to={`/bienvenue${hash}`} replace />
  }

  return estFondateur ? <DashboardPage /> : <DashboardCommercial />
}
