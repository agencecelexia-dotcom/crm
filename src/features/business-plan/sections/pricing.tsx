import { Badge } from '@/components/ui/badge'
import { businessPlan } from '../donnees'
import { Bloc, Section } from '../section'

/** 04 — La grille tarifaire, un cas par carte. */
export function SectionPricing() {
  return (
    <Section
      numero="04"
      titre="Grille de prix"
      sousTitre="Commission due à réception de l’acompte par l’artisan. Paiement à 15 jours."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {businessPlan.pricing.map((p) => (
          <Bloc key={p.cas}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{p.cas}</p>
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {p.taux}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{p.note}</p>
          </Bloc>
        ))}
      </div>
    </Section>
  )
}
