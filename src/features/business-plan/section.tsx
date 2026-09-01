import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Enveloppe commune à toutes les sections du business plan.
 *
 * Le numéro reste discret : il sert de repère dans une page longue, pas de
 * titre. C'est le libellé qu'on lit.
 */
export function Section({
  numero,
  titre,
  sousTitre,
  children,
}: {
  numero: string
  titre: string
  sousTitre?: string
  children: ReactNode
}) {
  return (
    <section className="mb-10" aria-labelledby={`bp-${numero}`}>
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{numero}</span>
        <h2 id={`bp-${numero}`} className="font-display text-lg tracking-tight">
          {titre}
        </h2>
      </div>
      {sousTitre && <p className="-mt-2 mb-3 text-sm text-muted-foreground">{sousTitre}</p>}
      {children}
    </section>
  )
}

/** Carte sobre : bordure fine, coins peu arrondis, aucun relief. */
export function Bloc({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      {children}
    </div>
  )
}
