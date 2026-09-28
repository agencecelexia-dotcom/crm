import { cn } from '@/lib/utils'
import { couleurPan } from './affichage-releve'
import { formatM2 } from './geometrie'
import type { Releve } from './releve'

/**
 * Les pans du toit relevé, chacun à sa pente et avec sa surface vraie. Un
 * couvreur ne refait pas toujours tout le toit : toucher un pan l'écarte (ou
 * le reprend), et la surface retenue suit — sur la carte aussi.
 */
export function ToitReleve({
  releve,
  ecartes,
  onBasculer,
}: {
  releve: Releve
  ecartes: Set<number>
  onBasculer: (id: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">Pans du toit</p>
        {releve.pans.length > 1 && <p className="text-[11px] text-muted-foreground">touchez un pan pour l’écarter</p>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {releve.pans.map((p) => {
          const garde = !ecartes.has(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onBasculer(p.id)}
                disabled={releve.pans.length === 1}
                aria-pressed={garde}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm transition-colors hover:bg-accent',
                  !garde && 'opacity-45',
                )}
              >
                <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: couleurPan(p.id) }} />
                <span className="min-w-0 flex-1 truncate">
                  {p.orientation === 'plat' ? 'Partie plate' : `Pan ${p.orientation}`}
                  <span className="text-muted-foreground"> · {Math.round(p.pente)} %</span>
                </span>
                <span className={cn('montant shrink-0', !garde && 'line-through')}>{formatM2(p.aireVraie)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
