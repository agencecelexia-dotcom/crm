import { Badge } from '@/components/ui/badge'
import { StatutBadge } from '@/components/statut-badge'
import type { StatutProjet } from '@/types/database'

/** L’artisan reçoit déjà un dossier attribué : son action est de contacter le client. */
export function StatutArtisan({ statut }: { statut: StatutProjet }) {
  if (statut !== 'artisan_assigne') return <StatutBadge statut={statut} />
  return <Badge variant="outline" className="shrink-0 gap-1.5 whitespace-nowrap rounded-md border-border bg-card px-2 py-1 text-xs font-medium text-foreground"><span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />À contacter</Badge>
}
