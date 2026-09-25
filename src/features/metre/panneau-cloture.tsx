import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatM, formatM2, type Point } from './geometrie'
import { coteLePlusProche, longueurCloture, type Parcelle } from './parcelle'

/**
 * La clôture, côté par côté.
 *
 * La parcelle cadastrale de la maison est tracée sur la carte ; chaque côté
 * est une pastille avec sa longueur. Le poseur coche ceux à clôturer — sur la
 * carte ou ici — et lit la longueur totale. Le côté qui longe l'adresse est
 * marqué « rue » : c'est le plus souvent celui qu'on clôture.
 */
export function PanneauCloture({
  parcelle,
  enCours,
  adresse,
  choisis,
  onBasculer,
  onEnregistrer,
  enregistrement,
}: {
  parcelle: Parcelle | null | undefined
  enCours: boolean
  /** Le point de l'adresse, qui tombe sur la rue. */
  adresse: Point | null
  choisis: Set<number>
  onBasculer: (index: number) => void
  onEnregistrer: () => void
  enregistrement: boolean
}) {
  if (enCours) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Recherche de la parcelle au cadastre…
      </p>
    )
  }
  if (!parcelle) {
    return (
      <p className="text-xs text-[#B45309]">
        La parcelle de cette maison n’est pas au cadastre de l’IGN : tracez la clôture avec « Mesurer une longueur ».
      </p>
    )
  }

  const rue = adresse ? coteLePlusProche(parcelle, adresse) : null
  const total = longueurCloture(parcelle, choisis)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Clôture</p>
        <p className="text-xs text-muted-foreground">
          Terrain {formatM2(parcelle.surface)} · tour {formatM(parcelle.perimetre)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">Touchez les côtés à clôturer, ici ou sur la carte.</p>
      <div className="flex flex-wrap gap-1.5">
        {parcelle.cotes.map((c) => {
          const actif = choisis.has(c.index)
          return (
            <button
              key={c.index}
              type="button"
              aria-pressed={actif}
              onClick={() => onBasculer(c.index)}
              className={cn(
                'min-h-11 rounded-full border px-3 text-sm transition-colors',
                actif ? 'border-[#EA580C] bg-[#EA580C]/10 font-medium text-[#C2410C]' : 'border-border bg-card hover:bg-accent',
              )}
            >
              {c.orientation} · {formatM(c.longueur)}
              {rue?.index === c.index && <span className="text-muted-foreground"> · rue</span>}
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-primary/5 p-2.5">
        <div>
          <p className="text-xs text-muted-foreground">Longueur à clôturer</p>
          <p className="montant text-lg font-semibold text-primary">{choisis.size ? formatM(total) : '—'}</p>
        </div>
        <Button className="min-h-11" disabled={!choisis.size || enregistrement} onClick={onEnregistrer}>
          {enregistrement ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Enregistrer
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Limites du plan cadastral : le bornage fait foi, pas le cadastre.
      </p>
    </div>
  )
}
