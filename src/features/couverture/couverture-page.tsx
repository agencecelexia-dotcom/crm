import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, MapPin, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS, SOUS_METIERS } from '@/lib/constants'
import { geocoder } from '@/lib/geocoding'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { CouvertureTableau } from './couverture-tableau'
import { CouvertureCarte } from './couverture-carte'
import { ListeAutour } from './liste-autour'
import { useCouvertureGrille, CIBLE_COUVERTURE } from './use-couverture'

// Cible de la liste d'appel : metier = null → toutes les sociétés (recherche par
// ville) ; metier renseigné → pré-filtré sur le métier (clic carte/tableau).
type Drill = { lat: number; lon: number; nom: string; metier: string | null }

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="montant text-xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
    </Card>
  )
}

export function CouverturePage() {
  const [params, setParams] = useSearchParams()
  const metier = params.get('metier') ?? METIERS[0]
  const onglet = params.get('vue') ?? 'carte'
  const sousParam = params.get('sous') ?? 'tous'
  const sousMetier = (SOUS_METIERS[metier] ?? []).includes(sousParam) ? sousParam : 'tous'

  const setParam = (cle: string, val: string, def: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (!val || val === def) n.delete(cle)
        else n.set(cle, val)
        return n
      },
      { replace: true },
    )

  const [drill, setDrill] = useState<Drill | null>(null)
  const [ville, setVille] = useState('')
  const [geocodage, setGeocodage] = useState(false)
  const { data: cells } = useCouvertureGrille(metier)
  const { data: artisans } = useArtisans()

  const stats = useMemo(() => {
    const list = cells ?? []
    const total = list.length
    const couvert = list.filter((c) => c.statut === 'couvert').length
    const trous = list.filter((c) => c.statut === 'vide').length
    return { total, couvert, trous, pct: total ? Math.round((couvert / total) * 100) : 0 }
  }, [cells])

  const sansCoord = (artisans ?? []).filter((a) => a.ecarte_at == null && a.latitude == null).length

  // Recherche par ville : géocode et ouvre la liste de TOUTES les sociétés autour.
  async function chercherVille() {
    if (!ville.trim()) return toast.error('Indique une ville')
    setGeocodage(true)
    try {
      const c = await geocoder(`${ville.trim()}, France`)
      if (!c) {
        toast.error('Ville introuvable')
        return
      }
      setDrill({ lat: c.lat, lon: c.lon, nom: ville.trim(), metier: null })
    } finally {
      setGeocodage(false)
    }
  }

  // Clic sur une ville (carte) ou une cellule (tableau) : pré-filtré sur le métier courant.
  const drillMetier = (z: { lat: number; lon: number; nom: string }) =>
    setDrill({ ...z, metier })

  return (
    <div>
      <PageHeader
        titre="Couverture"
        sousTitre={`Objectif : ${CIBLE_COUVERTURE} apporteurs par zone × sous-niche`}
      />

      <div className="mb-3 space-y-2">
        <Select value={metier} onValueChange={(v) => setParam('metier', v, '')}>
          <SelectTrigger className="h-11 w-full sm:w-64">
            <SelectValue placeholder="Métier" />
          </SelectTrigger>
          <SelectContent>
            {METIERS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Recherche par ville → toutes les sociétés autour, à appeler */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-9"
              placeholder="Une ville → toutes les sociétés autour à appeler (ex. Rennes)"
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && chercherVille()}
            />
          </div>
          <Button className="h-11" onClick={chercherVille} disabled={geocodage}>
            {geocodage ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Voir autour
          </Button>
        </div>
      </div>

      {/* Résultats INLINE : la liste des sociétés autour, juste sous la recherche */}
      {drill && (
        <ListeAutour
          key={`${drill.lat},${drill.lon}`}
          lat={drill.lat}
          lon={drill.lon}
          nom={drill.nom}
          metierInit={drill.metier}
          onClose={() => setDrill(null)}
        />
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Couverture" value={`${stats.pct}%`} color="#22C55E" />
        <Stat label="Cellules couvertes" value={`${stats.couvert}/${stats.total}`} />
        <Stat label="Trous (0 artisan)" value={String(stats.trous)} color="#EF4444" />
        <Stat label="Artisans sans GPS" value={`${sansCoord}`} />
      </div>

      <Tabs value={onglet} onValueChange={(v) => setParam('vue', v, 'carte')}>
        <TabsList className="mb-3">
          <TabsTrigger value="carte">Carte</TabsTrigger>
          <TabsTrigger value="tableau">Tableau</TabsTrigger>
        </TabsList>

        <TabsContent value="carte">
          <div className="mb-2">
            <Select value={sousMetier} onValueChange={(v) => setParam('sous', v, 'tous')}>
              <SelectTrigger className="h-10 w-full sm:w-64">
                <SelectValue placeholder="Sous-niche" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Toutes sous-niches</SelectItem>
                {(SOUS_METIERS[metier] ?? []).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CouvertureCarte
            metier={metier}
            sousMetier={sousMetier === 'tous' ? null : sousMetier}
            onDrill={drillMetier}
          />
        </TabsContent>

        <TabsContent value="tableau">
          <CouvertureTableau metier={metier} onDrill={drillMetier} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
