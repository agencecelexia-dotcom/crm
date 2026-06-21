import { useState } from 'react'
import { X } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS } from '@/lib/constants'
import { useProspectsAutour } from '@/features/prospects/use-prospects'
import { ProspectRow } from '@/features/prospects/prospects-panel'

// Liste INLINE des sociétés à démarcher autour d'un point (ville recherchée ou
// zone cliquée). Triée par distance ; filtre métier ; appel + recrutement direct.
export function ListeAutour({
  lat,
  lon,
  nom,
  metierInit,
  onClose,
}: {
  lat: number
  lon: number
  nom: string
  metierInit: string | null
  onClose: () => void
}) {
  const [metier, setMetier] = useState(metierInit || 'tous')
  const metierParam = metier === 'tous' ? null : metier
  const { data: prospects, isLoading } = useProspectsAutour(lat, lon, metierParam, 200)

  return (
    <Card className="mb-4 space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">Sociétés autour de {nom}</p>
          <p className="text-xs text-muted-foreground">
            Du plus proche au plus loin — appelle, puis qualifie / recrute.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X className="size-4" />
        </Button>
      </div>

      <Select value={metier} onValueChange={setMetier}>
        <SelectTrigger className="h-10 w-full sm:w-56">
          <SelectValue placeholder="Métier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tous">Tous métiers</SelectItem>
          {METIERS.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : !prospects || prospects.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Aucune société à démarcher ici pour ce filtre.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {prospects.length} société(s) — triées par distance
          </p>
          {prospects.map((p) => (
            <ProspectRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </Card>
  )
}
