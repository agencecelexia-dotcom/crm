import { useEffect, useRef } from 'react'
import { AlertTriangle, Check, CircleDashed, Keyboard, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { nbRestant, type Anomalie, type LeadExtrait, type LigneChecklist } from './checklist'

/**
 * Checklist de l'appel, en deux zones distinctes.
 *
 * L'ordre des lignes est FIXE. Une première version les retriait par urgence à
 * chaque extraction : le champ qu'on était en train de remplir se déplaçait
 * sous le curseur toutes les quelques secondes, ce qui rendait la saisie
 * clavier impraticable. Une liste stable se lit d'un coup d'œil ; une liste
 * qui bouge oblige à la relire entièrement.
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
  onSaisir: (cle: keyof LeadExtrait, valeur: string) => void
}) {
  const restant = nbRestant(lignes)
  // Les champs qu'on saisit à la main pendant l'appel : identité et contact.
  // Le reste (demande, surface, délai…) se capte bien à l'oral et n'a pas
  // besoin d'être tapé.
  const CLES_CONTACT: (keyof LeadExtrait)[] = [
    'client_nom',
    'client_telephone',
    'client_email',
    'client_adresse',
    'client_code_postal',
    'client_ville',
  ]

  const contact = CLES_CONTACT.map((c) => lignes.find((l) => l.cle === c)).filter(
    (l): l is LigneChecklist => l != null,
  )
  const ecoute = lignes.filter((l) => !CLES_CONTACT.includes(l.cle))

  return (
    <div className="space-y-3">
      {/* ------- Zone 1 : ce que je note ------- */}
      <div className="rounded-2xl border border-[#7C3AED]/30 bg-card shadow-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Keyboard className="size-4 text-[#7C3AED]" />
          <p className="text-sm font-semibold">Ce que je note</p>
          <span className="ml-auto text-xs text-muted-foreground">
            prioritaire sur l'écoute
          </span>
        </div>
        <div className="space-y-1.5 p-3">
          {contact.map((l) => (
            <ChampSaisie key={l.cle} ligne={l} onSaisir={onSaisir} />
          ))}
        </div>
      </div>

      {/* ------- Zone 2 : ce que l'IA entend ------- */}
      <div className="rounded-2xl border border-border/70 bg-card shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">Ce que l'IA entend</p>
          {extraitEnCours ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              analyse…
            </span>
          ) : (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                restant === 0 ? 'bg-[#22C55E]/15 text-[#16A34A]' : 'bg-[#F59E0B]/15 text-[#B45309]',
              )}
            >
              {restant === 0 ? 'complet' : `${restant} à demander`}
            </span>
          )}
        </div>
        <ul className="divide-y divide-border/60">
          {ecoute.map((l) => (
            <li key={l.cle} className="flex items-start gap-2.5 px-4 py-2">
              <span className="mt-0.5 shrink-0">
                {l.etat === 'saisi' ? (
                  <Keyboard className="size-4 text-[#7C3AED]" />
                ) : l.etat === 'obtenu' ? (
                  <Check className="size-4 text-[#16A34A]" />
                ) : l.etat === 'a_confirmer' ? (
                  <AlertTriangle className="size-4 text-[#B45309]" />
                ) : (
                  <CircleDashed
                    className={cn(
                      'size-4',
                      l.essentiel ? 'text-[#DC2626]' : 'text-muted-foreground',
                    )}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{l.label}</p>
                {l.valeur ? (
                  <p
                    className={cn(
                      'text-sm',
                      l.etat === 'a_confirmer' ? 'text-[#B45309]' : 'font-medium',
                    )}
                  >
                    {l.valeur}
                    {l.etat === 'a_confirmer' && (
                      <span className="ml-1.5 text-xs font-normal">— à confirmer</span>
                    )}
                  </p>
                ) : (
                  <p
                    className={cn(
                      'text-sm',
                      l.essentiel ? 'text-[#DC2626]' : 'text-muted-foreground',
                    )}
                  >
                    {l.question}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {anomalies.length > 0 && (
          <div className="border-t border-border px-4 py-2.5">
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
    </div>
  )
}

/**
 * Champ de saisie manuelle.
 *
 * Le champ n'est PAS piloté par la valeur extraite tant qu'il a le focus :
 * un `value` réécrit par l'extraction déplaçait le curseur et effaçait la
 * frappe en cours. On ne se synchronise sur l'écoute que hors focus.
 */
function ChampSaisie({
  ligne,
  onSaisir,
}: {
  ligne: LigneChecklist
  onSaisir: (cle: keyof LeadExtrait, valeur: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    if (el.value !== ligne.valeur) el.value = ligne.valeur
  }, [ligne.valeur])

  return (
    <div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={`s-${ligne.cle}`}
          className="w-20 shrink-0 text-xs text-muted-foreground sm:w-24"
        >
          {ligne.label}
        </label>
        <input
          ref={ref}
          id={`s-${ligne.cle}`}
          defaultValue={ligne.valeur}
          onChange={(e) => onSaisir(ligne.cle, e.target.value)}
          placeholder={ligne.question}
          autoComplete="off"
          inputMode={
            ligne.cle === 'client_telephone' || ligne.cle === 'client_code_postal'
              ? 'numeric'
              : ligne.cle === 'client_email'
                ? 'email'
                : 'text'
          }
          className={cn(
            'min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'placeholder:text-xs placeholder:text-muted-foreground/70',
            ligne.manuel
              ? 'border-[#7C3AED]/40 bg-[#7C3AED]/5 font-medium'
              : ligne.valeur
                ? 'border-[#22C55E]/30 bg-[#22C55E]/5'
                : 'border-border bg-transparent',
          )}
        />
        {/* Coche verte : l'écoute a confirmé ce champ. */}
        {!ligne.manuel && ligne.valeur && (
          <Check className="size-4 shrink-0 text-[#16A34A]" aria-label="capté par l'écoute" />
        )}
      </div>

      {ligne.suggestionIa && (
        <button
          type="button"
          onClick={() => onSaisir(ligne.cle, ligne.suggestionIa!)}
          className="ml-[5.5rem] mt-0.5 flex items-center gap-1 text-left text-xs text-[#B45309] hover:underline sm:ml-[6.5rem]"
        >
          <AlertTriangle className="size-3 shrink-0" />
          l'IA entend «&nbsp;{ligne.suggestionIa}&nbsp;»
        </button>
      )}
    </div>
  )
}
