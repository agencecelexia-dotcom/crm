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
  return estFondateur ? <DashboardPage /> : <DashboardCommercial />
}
