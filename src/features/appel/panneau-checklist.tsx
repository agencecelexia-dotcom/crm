import { AlertTriangle, Check, CircleDashed, Keyboard, Loader2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  nbRestant,
  trierPourAppel,
  type Anomalie,
  type LeadExtrait,
  type LigneChecklist,
} from './checklist'

/**
 * La checklist affichée pendant l'appel.
 *
 * Contrainte de lecture : le commercial y jette des coups d'œil tout en
 * parlant. Ce qui reste à demander est donc EN HAUT, en rouge, formulé comme
 * une question prête à poser — pas comme un nom de champ à remplir.
 *
 * Chaque ligne est aussi une zone de saisie. Le commercial peut taper pendant
 * qu'il écoute : sa frappe fait autorité et l'extraction ne l'écrase jamais.
 * Quand les deux sources divergent, la proposition de l'IA reste affichée
 * dessous — c'est le bénéfice réel de la double saisie : deux versions d'un
 * numéro de téléphone, ça se vérifie avant de raccrocher, pas après.
 */
export function PanneauChecklist({
  lignes,
  anomalies,
  extraitEnCours,
  onSaisir,
}: {
  lignes: LigneChecklist[]
  anomalies: Anomalie[]
  extraitEnCours: boolean
  /** Frappe du commercial. Une valeur vide rend la main à l'extraction. */
  onSaisir: (cle: keyof LeadExtrait, valeur: string) => void
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
          <li key={l.cle} className="px-3 py-2">
            <div className="flex items-center gap-2.5">
              <span className="shrink-0" title={etatLabel(l)}>
                {l.etat === 'saisi' ? (
                  <Keyboard className="size-4 text-[#7C3AED]" />
                ) : l.etat === 'obtenu' ? (
                  <Check className="size-4 text-[#16A34A]" />
                ) : l.etat === 'a_confirmer' ? (
                  <AlertTriangle className="size-4 text-[#B45309]" />
                ) : (
                  <CircleDashed
                    className={cn('size-4', l.essentiel ? 'text-[#DC2626]' : 'text-muted-foreground')}
                  />
                )}
              </span>

              <label
                htmlFor={`ch-${l.cle}`}
                className={cn(
                  'w-24 shrink-0 truncate text-xs sm:w-28',
                  l.etat === 'manquant' && l.essentiel
                    ? 'font-medium text-[#DC2626]'
                    : 'text-muted-foreground',
                )}
              >
                {l.label}
              </label>

              <input
                id={`ch-${l.cle}`}
                value={l.valeur}
                onChange={(e) => onSaisir(l.cle, e.target.value)}
                placeholder={l.etat === 'manquant' ? l.question : ''}
                autoComplete="off"
                className={cn(
                  'min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                  'placeholder:text-xs',
                  l.etat === 'saisi' && 'border-[#7C3AED]/40 bg-[#7C3AED]/5 font-medium',
                  l.etat === 'obtenu' && 'border-transparent font-medium',
                  l.etat === 'a_confirmer' && 'border-[#B45309]/40 bg-[#F59E0B]/5 text-[#B45309]',
                  l.etat === 'manquant' &&
                    (l.essentiel
                      ? 'border-[#DC2626]/30 placeholder:text-[#DC2626]/70'
                      : 'border-border placeholder:text-muted-foreground'),
                )}
              />

              {/* Rendre la main à l'extraction sans avoir à tout effacer. */}
              {l.manuel && (
                <button
                  type="button"
                  onClick={() => onSaisir(l.cle, '')}
                  title="Effacer et laisser l'IA remplir"
                  aria-label="Effacer et laisser l'IA remplir"
                  className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Divergence entre la frappe et l'écoute : le point exact où une
                double vérification a de la valeur. */}
            {l.suggestionIa && (
              <button
                type="button"
                onClick={() => onSaisir(l.cle, l.suggestionIa!)}
                className="mt-1 ml-[3.1rem] flex items-center gap-1 text-left text-xs text-[#B45309] hover:underline sm:ml-[3.9rem]"
              >
                <AlertTriangle className="size-3 shrink-0" />
                l'IA a entendu «&nbsp;{l.suggestionIa}&nbsp;» — cliquer pour reprendre
              </button>
            )}
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

function etatLabel(l: LigneChecklist): string {
  switch (l.etat) {
    case 'saisi':
      return 'Saisi au clavier — prioritaire sur l’écoute'
    case 'obtenu':
      return 'Capté par l’écoute'
    case 'a_confirmer':
      return 'Capté, mais peu sûr — à confirmer'
    default:
      return 'À demander'
  }
}
