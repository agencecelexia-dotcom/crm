import { Badge } from '@/components/ui/badge'
import { STATUTS } from '@/lib/constants'
import type { StatutProjet } from '@/types/database'

// Badge coloré selon le statut du projet (couleurs sémantiques de la spec).
export function StatutBadge({ statut }: { statut: StatutProjet }) {
  const { label, color, textOnColor } = STATUTS[statut]
  return (
    <Badge
      style={{ backgroundColor: color, color: textOnColor }}
      className="border-transparent"
    >
      {label}
    </Badge>
  )
}
