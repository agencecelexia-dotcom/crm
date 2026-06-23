import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPinned, Pencil, CheckCircle2 } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DEPARTEMENTS_CODES } from '@/lib/constants'
import { useArtisans } from '../hooks/use-artisans'
import type { Artisan } from '@/types/database'

const invalides = (a: Artisan) =>
  (a.departements_couverts ?? []).filter((c) => !DEPARTEMENTS_CODES.has(c))
const deptsValides = (a: Artisan) =>
  (a.departements_couverts ?? []).filter((c) => DEPARTEMENTS_CODES.has(c))
const aUneZone = (a: Artisan) =>
  (a.zones_couvertes?.length ?? 0) > 0 ||
  deptsValides(a).length > 0 ||
  (a.rayon_km != null && a.latitude != null && a.longitude != null)

// Page de contrôle : artisans dont la zone est mal renseignée (départements invalides)
// ou inexistante (donc non mappés sur la couverture).
export function ArtisansZonesPage() {
  const { data: artisans, isLoading } = useArtisans()

  const aCorriger = useMemo(() => {
    return (artisans ?? [])
      .filter((a) => a.ecarte_at == null)
      .map((a) => {
        const inval = invalides(a)
        const sansZone = !aUneZone(a)
        const raisons: string[] = []
        if (inval.length) raisons.push(`Départements invalides : ${inval.join(', ')}`)
        if (sansZone) raisons.push('Aucune zone d’intervention (non mappé sur la couverture)')
        return { a, raisons }
      })
      .filter((x) => x.raisons.length > 0)
  }, [artisans])

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        titre="Zones à vérifier"
        back
        sousTitre="Artisans dont la zone est mal renseignée ou manquante — à recadrer pour bien les mapper."
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : aCorriger.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <CheckCircle2 className="size-10 text-[#22C55E]" />
          <p className="font-medium">Tout est carré 🎉</p>
          <p className="text-sm text-muted-foreground">
            Tous les artisans actifs ont une zone d’intervention valide.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {aCorriger.map(({ a, raisons }) => (
            <li key={a.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {[a.prenom, a.nom].filter(Boolean).join(' ')}
                    {a.societe && <span className="text-muted-foreground"> · {a.societe}</span>}
                  </p>
                  {a.source?.startsWith('auto:') && (
                    <Badge variant="secondary" className="my-0.5 text-[11px]">
                      🌐 {a.source.slice(5)}
                    </Badge>
                  )}
                  {raisons.map((r) => (
                    <p key={r} className="flex items-center gap-1 text-xs text-[#B91C1C]">
                      <MapPinned className="size-3.5 shrink-0" /> {r}
                    </p>
                  ))}
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link to={`/artisans/${a.id}/edit`}>
                    <Pencil className="size-3.5" />
                    Corriger
                  </Link>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
