import { ExternalLink } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatEuros, formatDate } from '@/lib/format'
import { useDevisProjet } from './use-devis'

// Devis générés (par l'artisan) rattachés à ce projet — visibles côté agence.
export function DevisProjetCard({ projetId }: { projetId: string }) {
  const { data: devis } = useDevisProjet(projetId)
  if (!devis || devis.length === 0) return null

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Devis ({devis.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {devis.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {d.numero} · {formatEuros(d.total)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {d.objet || d.client_nom || ''}
                {d.date_devis ? ` · ${formatDate(d.date_devis)}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={d.statut === 'envoye' ? 'default' : 'secondary'}>
                {d.statut === 'envoye' ? 'Envoyé' : 'Brouillon'}
              </Badge>
              {d.pdf_url && (
                <a
                  href={d.pdf_url}
                  target="_blank"
                  rel="noopener"
                  className="text-primary"
                  aria-label="Ouvrir le PDF"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
