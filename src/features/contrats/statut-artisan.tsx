import { StatutBadge } from '@/components/statut-badge'
import type { StatutProjet } from '@/types/database'

/** L’artisan reçoit déjà un dossier attribué : son action est de contacter le client. */
export function StatutArtisan({ statut }: { statut: StatutProjet }) {
  return <StatutBadge statut={statut} label={statut === 'artisan_assigne' ? 'À contacter' : undefined} />
}
