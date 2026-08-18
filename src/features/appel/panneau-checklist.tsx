import { AlertTriangle, Check, CircleDashed, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { nbRestant, trierPourAppel, type Anomalie, type LigneChecklist } from './checklist'

/**
 * La checklist affichée pendant l'appel.
 *
 * Contrainte de lecture : le commercial y jette des coups d'œil tout en
 * parlant. Ce qui reste à demander est donc EN HAUT, en rouge, formulé comme
 * une question prête à poser — pas comme un nom de champ à remplir.
 */
export function PanneauChecklist({
  lignes,
  anomalies,
  extraitEnCours,
}: {
  lignes: LigneChecklist[]
  anomalies: Anomalie[]
  extraitEnCours: boolean
}) {
  const triees = trierPourAppel(lignes)
  const restant = nbRestant(lignes)

  return (
    <div className="rounded-2xl border border-border/70 bg-card shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">Informations à recueillir</p>
        {extraitEnCours ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            analyse…
          </span>
        ) : (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              restant === 0
                ? 'bg-[#22C55E]/15 text-[#16A34A]'
                : 'bg-[#F59E0B]/15 text-[#B45309]',
            )}
          >
            {restant === 0 ? 'complet' : `${restant} à demander`}
          </span>
        )}
      </div>

      <ul className="divide-y divide-border/60">
        {triees.map((l) => (
          <li key={l.cle} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 shrink-0">
              {l.etat === 'obtenu' ? (
                <Check className="size-4 text-[#16A34A]" />
              ) : l.etat === 'a_confirmer' ? (
                <AlertTriangle className="size-4 text-[#B45309]" />
              ) : (
                <CircleDashed
                  className={cn('size-4', l.essentiel ? 'text-[#DC2626]' : 'text-muted-foreground')}
                />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm',
                  l.etat === 'manquant' && l.essentiel && 'font-medium text-[#DC2626]',
                  l.etat === 'manquant' && !l.essentiel && 'text-muted-foreground',
                )}
              >
                {l.etat === 'manquant' ? l.question : l.label}
              </p>

              {l.valeur && (
                <p
                  className={cn(
                    'truncate text-sm',
                    l.etat === 'a_confirmer'
                      ? 'text-[#B45309]'
                      : 'font-medium text-foreground',
                  )}
                >
                  {l.valeur}
                  {l.etat === 'a_confirmer' && (
                    <span className="ml-1.5 text-xs font-normal">— à confirmer</span>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {anomalies.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          {anomalies.map((a, i) => (
            <p
              key={i}
              className={cn(
                'flex items-start gap-1.5 text-xs',
                a.gravite === 'bloquant' ? 'text-[#DC2626]' : 'text-[#B45309]',
              )}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {a.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
