import { MessageSquare } from 'lucide-react'

import { cn } from '@/lib/utils'
import { dateLisible, dernierSuiviParlant } from './dernier-suivi'
import type { ProjetEspace } from '@/types/database'

/**
 * Aperçu du dernier échange, affiché au survol d'un chantier.
 *
 * Permet de balayer le pipe sans ouvrir chaque fiche : « où en étais-je avec
 * celui-là ? » est la question qu'on se pose en parcourant la liste, et y
 * répondre demandait jusqu'ici un clic puis un retour.
 *
 * Sur écran tactile il n'y a pas de survol : l'aperçu est aussi rendu en
 * permanence sous la carte, en version compacte (`variante="inline"`).
 */

export function ApercuDernierSuivi({
  projet,
  variante = 'survol',
}: {
  projet: ProjetEspace
  variante?: 'survol' | 'inline'
}) {
  const s = dernierSuiviParlant(projet)
  if (!s) return null

  const deLagence = s.auteur === 'agence'
  const qui = deLagence ? 'Celexia' : 'Vous'

  if (variante === 'inline') {
    return (
      <p className="flex items-start gap-1.5 px-4 pb-2.5 text-xs text-muted-foreground sm:px-5">
        <MessageSquare className="mt-0.5 size-3 shrink-0" />
        <span className="min-w-0">
          <span className={cn('font-medium', deLagence && 'text-primary')}>{qui}</span>
          <span className="opacity-70"> · {dateLisible(s.created_at)}</span>
          <span className="block truncate">{s.message}</span>
        </span>
      </p>
    )
  }

  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none absolute left-4 right-4 top-full z-20 -mt-1',
        'rounded-xl border border-border bg-popover p-3 shadow-lg',
        'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
        // Masqué au tactile, où le survol n'existe pas : la variante inline
        // prend le relais.
        'hidden sm:block',
      )}
    >
      <p className="mb-1 flex items-baseline gap-1.5 text-xs">
        <span className={cn('font-semibold', deLagence && 'text-primary')}>{qui}</span>
        <span className="text-muted-foreground">{dateLisible(s.created_at)}</span>
      </p>
      <p className="whitespace-pre-wrap text-sm leading-snug">{s.message}</p>
    </div>
  )
}
