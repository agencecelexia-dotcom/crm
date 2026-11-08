import { Badge } from '@/components/ui/badge'
import { statutInfo } from '@/lib/constants'
import type { StatutProjet } from '@/types/database'

// Badge coloré selon le statut du projet (couleurs sémantiques de la spec).
// Le statut vient de la base, où la colonne est un `text` sans contrainte :
// on passe par statutInfo() plutôt qu'un accès indexé, qui planterait sur une
// valeur inattendue et blanchirait la page entière.
export function StatutBadge({ statut }: { statut: StatutProjet }) {
  const { label, color } = statutInfo(statut)
  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-1.5 whitespace-nowrap rounded-md border-border bg-card px-2 py-1 text-xs font-medium text-foreground"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </Badge>
  )
}
