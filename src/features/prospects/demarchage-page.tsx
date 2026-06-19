import { useState } from 'react'
import { Search, Loader2, MapPin } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS } from '@/lib/constants'
import { geocoder } from '@/lib/geocoding'
import { useProspectsAutour } from './use-prospects'
import { ProspectRow } from './prospects-panel'

// Démarchage : chercher des sociétés à contacter par métier + zone.
export function DemarchagePage() {
  const [metier, setMetier] = useState('tous')
  const [ville, setVille] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [geocodage, setGeocodage] = useState(false)

  const metierParam = metier === 'tous' ? null : metier
  const { data: prospects, isLoading } = useProspectsAutour(coords?.lat, coords?.lon, metierParam, 200)

  async function chercher() {
    if (!ville.trim()) return toast.error('Indique une ville ou une zone')
    setGeocodage(true)
    try {
      const c = await geocoder(`${ville.trim()}, France`)
      if (!c) {
        toast.error('Zone introuvable')
        return
      }
      setCoords(c)
    } finally {
      setGeocodage(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        titre="Démarchage"
        sousTitre="Trouver des sociétés à contacter par métier et par zone (du plus proche au plus loin)"
      />

      <div className="mb-4 space-y-2">
        <Select value={metier} onValueChange={setMetier}>
          <SelectTrigger className="h-11 w-full">
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
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-9"
              placeholder="Ville ou zone (ex. Rennes, ou 35000)"
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && chercher()}
            />
          </div>
          <Button className="h-11" onClick={chercher} disabled={geocodage}>
            {geocodage ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Chercher
          </Button>
        </div>
      </div>

      {!coords ? (
        <EmptyState
          icon={Search}
          titre="Cherche une zone"
          description="Choisis un métier et une ville pour voir les sociétés à démarcher autour, triées par distance."
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : !prospects || prospects.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Aucune société à démarcher pour ce métier autour de « {ville} ».
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{prospects.length} société(s) — triées par distance</p>
          {prospects.map((p) => (
            <ProspectRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  )
}
