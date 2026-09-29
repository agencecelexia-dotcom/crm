import { cn } from '@/lib/utils'
import { couleurPan, LIGNES } from './affichage-releve'
import { formatM, formatM2 } from './geometrie'
import { lignesRetenues, TYPES_LIGNES, type Releve } from './releve'

/**
 * Les pans du toit relevé, chacun à sa pente et avec sa surface vraie. Un
 * couvreur ne refait pas toujours tout le toit : toucher un pan l'écarte (ou
 * le reprend), et la surface retenue suit — sur la carte aussi. Une terrasse
 * est écartée d'office, et dite comme telle.
 *
 * Dessous, les linéaires qu'il chiffre au mètre : faîtage, arêtiers, noues,
 * égouts, rives — ceux des pans retenus.
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
  const retenus = ecartes.size ? releve.pans.filter((p) => !ecartes.has(p.id)).map((p) => p.id) : null
  const { totaux } = lignesRetenues(releve, retenus)
  const lignes = TYPES_LIGNES.filter((t) => totaux[t].nombre > 0)
  return (
    <div className="space-y-3">
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
                    {p.terrasse ? 'Terrasse' : p.orientation === 'plat' ? 'Partie plate' : `Pan ${p.orientation}`}
                    <span className="text-muted-foreground">
                      {p.terrasse ? (garde ? ' · comptée' : ' · non comptée') : ` · ${Math.round(p.pente)} %`}
                    </span>
                  </span>
                  <span className={cn('montant shrink-0', !garde && 'line-through')}>{formatM2(p.aireVraie)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {lignes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Linéaires</p>
          <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {lignes.map((t) => (
              <div key={t} className="flex min-h-10 items-center gap-2.5 px-3 text-sm">
                <span className="h-0.5 w-4 shrink-0 rounded-full" style={{ backgroundColor: LIGNES[t].couleur }} />
                <dt className="min-w-0 flex-1 truncate">
                  {totaux[t].nombre > 1 ? LIGNES[t].pluriel : LIGNES[t].libelle}
                  {totaux[t].nombre > 1 && <span className="text-muted-foreground"> · {totaux[t].nombre}</span>}
                </dt>
                <dd className="montant shrink-0">{formatM(totaux[t].longueur)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Longueurs vraies, pente comprise, lues à l’intersection des pans et sur le bord du toit.
          </p>
        </div>
      )}
    </div>
  )
}
