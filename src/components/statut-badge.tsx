import { Badge } from '@/components/ui/badge'
import { statutInfo } from '@/lib/constants'
import type { StatutProjet } from '@/types/database'

// Badge coloré selon le statut du projet (couleurs sémantiques de la spec).
// Le statut vient de la base, où la colonne est un `text` sans contrainte :
// on passe par statutInfo() plutôt qu'un accès indexé, qui planterait sur une
// valeur inattendue et blanchirait la page entière.
export function StatutBadge({ statut }: { statut: StatutProjet }) {
  const { label, color, textOnColor } = statutInfo(statut)
  return (
    <Badge
      style={{ backgroundColor: color, color: textOnColor }}
      className="shrink-0 whitespace-nowrap border-transparent"
    >
      {label}
    </Badge>
  )
}
