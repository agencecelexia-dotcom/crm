import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDateHeure } from '@/lib/format'
import { useRelancesProjet } from './use-automatisations'

const LABEL: Record<string, string> = {
  contrat: 'Relance contrat → artisan',
  contrat_escalade: 'Escalade « à appeler »',
  inaction: 'Relance inaction → artisan',
  inaction_escalade: 'Escalade « à appeler »',
}

// Timeline des relances automatiques envoyées pour ce projet.
export function RelancesProjetCard({ projetId }: { projetId: string }) {
  const { data: relances } = useRelancesProjet(projetId)
  if (!relances || relances.length === 0) return null
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Relances automatiques</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {relances.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <Badge
                variant="secondary"
                className="shrink-0 text-xs"
                style={r.type.includes('escalade') ? { backgroundColor: '#EF4444', color: '#fff' } : undefined}
              >
                {LABEL[r.type] ?? r.type}
              </Badge>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateHeure(r.sent_at)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
