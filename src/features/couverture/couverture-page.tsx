import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS, SOUS_METIERS } from '@/lib/constants'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { ProspectsPanel } from '@/features/prospects/prospects-panel'
import { CouvertureTableau } from './couverture-tableau'
import { CouvertureCarte } from './couverture-carte'
import { useCouvertureGrille, CIBLE_COUVERTURE } from './use-couverture'

type Drill = { lat: number; lon: number; nom: string }

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
    </Card>
  )
}

export function CouverturePage() {
  const [params, setParams] = useSearchParams()
  const metier = params.get('metier') ?? METIERS[0]
  const onglet = params.get('vue') ?? 'tableau'
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

  return (
    <div>
      <PageHeader
        titre="Couverture"
        sousTitre={`Objectif : ${CIBLE_COUVERTURE} apporteurs par zone × sous-niche`}
      />

      <div className="mb-3">
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
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Couverture" value={`${stats.pct}%`} color="#22C55E" />
        <Stat label="Cellules couvertes" value={`${stats.couvert}/${stats.total}`} />
        <Stat label="Trous (0 artisan)" value={String(stats.trous)} color="#EF4444" />
        <Stat label="Artisans sans GPS" value={`${sansCoord}`} />
      </div>

      <Tabs value={onglet} onValueChange={(v) => setParam('vue', v, 'tableau')}>
        <TabsList className="mb-3">
          <TabsTrigger value="tableau">Tableau</TabsTrigger>
          <TabsTrigger value="carte">Carte</TabsTrigger>
        </TabsList>

        <TabsContent value="tableau">
          <CouvertureTableau metier={metier} onDrill={setDrill} />
        </TabsContent>

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
            onDrill={setDrill}
          />
        </TabsContent>
      </Tabs>

      {drill && (
        <ProspectsPanel
          lat={drill.lat}
          lon={drill.lon}
          metierDefault={metier}
          contexte={drill.nom}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  )
}
