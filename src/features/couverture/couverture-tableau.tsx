import { useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SOUS_METIERS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { CouvertureCell } from '@/types/database'
import { useCouvertureGrille, CIBLE_COUVERTURE, STATUT_COULEUR } from './use-couverture'

interface ZoneRow {
  zone_id: string
  zone: string
  lat: number
  lon: number
  departement: string | null
  cells: Record<string, CouvertureCell>
}

export function CouvertureTableau({
  metier,
  onDrill,
}: {
  metier: string
  onDrill: (z: { lat: number; lon: number; nom: string }) => void
}) {
  const { data: cells, isLoading } = useCouvertureGrille(metier)
  const [trousSeulement, setTrousSeulement] = useState(true)
  const [dept, setDept] = useState('tous')
  const sousNiches = useMemo(() => SOUS_METIERS[metier] ?? [], [metier])

  const { rows, depts } = useMemo(() => {
    const map = new Map<string, ZoneRow>()
    for (const c of cells ?? []) {
      let r = map.get(c.zone_id)
      if (!r) {
        r = {
          zone_id: c.zone_id,
          zone: c.zone,
          lat: c.lat,
          lon: c.lon,
          departement: c.departement,
          cells: {},
        }
        map.set(c.zone_id, r)
      }
      r.cells[c.sous_metier] = c
    }
    let list = [...map.values()]
    const depts = [...new Set(list.map((r) => r.departement).filter(Boolean))].sort() as string[]
    if (dept !== 'tous') list = list.filter((r) => r.departement === dept)
    if (trousSeulement)
      list = list.filter((r) => sousNiches.some((s) => (r.cells[s]?.n ?? 0) < CIBLE_COUVERTURE))
    list.sort((a, b) => {
      const ta = sousNiches.filter((s) => (a.cells[s]?.n ?? 0) === 0).length
      const tb = sousNiches.filter((s) => (b.cells[s]?.n ?? 0) === 0).length
      return tb - ta || a.zone.localeCompare(b.zone)
    })
    return { rows: list, depts }
  }, [cells, dept, trousSeulement, sousNiches])

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger className="h-10 w-40">
            <SelectValue placeholder="Département" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">Tous départements</SelectItem>
            {depts.map((d) => (
              <SelectItem key={d} value={d}>
                Dépt {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={trousSeulement} onCheckedChange={setTrousSeulement} />
          Trous seulement
        </label>
        <span className="text-xs text-muted-foreground">
          {rows.length} zone{rows.length > 1 ? 's' : ''} · cible {CIBLE_COUVERTURE}/cellule · clic = démarcher
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {trousSeulement ? '🎉 Aucun trou sur ce filtre — tout est couvert !' : 'Aucune zone.'}
        </p>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="sticky left-0 z-20 border-b border-border bg-card px-3 py-2 text-left font-medium">
                  Zone
                </th>
                {sousNiches.map((s) => (
                  <th
                    key={s}
                    className="border-b border-border px-2 py-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.zone_id} className="hover:bg-accent/30">
                  <td className="sticky left-0 z-10 border-b border-border bg-card px-3 py-1.5">
                    <span className="font-medium">{r.zone}</span>
                    {r.departement && (
                      <span className="ml-1 text-xs text-muted-foreground">({r.departement})</span>
                    )}
                  </td>
                  {sousNiches.map((s) => {
                    const c = r.cells[s]
                    const n = c?.n ?? 0
                    const statut = c?.statut ?? 'vide'
                    const color = STATUT_COULEUR[statut]
                    return (
                      <td key={s} className="border-b border-border p-1 text-center">
                        <button
                          type="button"
                          onClick={() => onDrill({ lat: r.lat, lon: r.lon, nom: r.zone })}
                          title={`${r.zone} · ${s} — démarcher`}
                          className={cn(
                            'mx-auto flex h-7 w-10 items-center justify-center rounded-md text-xs font-semibold transition-transform hover:scale-110',
                          )}
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          {n}/{CIBLE_COUVERTURE}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
