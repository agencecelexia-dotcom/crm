import { AlertTriangle, ChevronDown, Lock, MapPin } from 'lucide-react'

import { cn } from '@/lib/utils'
import { StatutBadge } from '@/components/statut-badge'
import { formatEuros } from '@/lib/format'
import { statutInfo } from '@/lib/constants'
import { ancienneteLabel, COULEUR_URGENCE, estNouveau, urgenceChantier } from './urgence-chantier'
import type { ProjetEspace } from '@/types/database'

/**
 * En-tête d'un chantier, partagé par la liste, le kanban et le drawer.
 *
 * Corrige deux points de l'audit §9 :
 *  • l'en-tête était un <button> de près de 70 lignes contenant d'autres
 *    éléments interactifs — imbrication invalide. Le bouton est désormais
 *    réduit au chevron, et la zone cliquable passe par un gestionnaire sur le
 *    conteneur, sans imbriquer d'interactif dans un interactif ;
 *  • la hiérarchie était inversée : le métier en gros et noir, le client en
 *    gris clair. On scanne ces cartes pour retrouver un CLIENT.
 */
export function EnteteChantier({
  projet,
  signe,
  ouvert,
  onToggle,
  compact,
}: {
  projet: ProjetEspace
  signe: boolean
  /** Non fourni = en-tête non dépliable (kanban, drawer). */
  ouvert?: boolean
  onToggle?: () => void
  /** Variante dense, pour les colonnes du kanban. */
  compact?: boolean
}) {
  const metiers = projet.metiers?.length ? projet.metiers : [projet.metier]
  const montant = projet.montant_devis_signe ?? projet.montant_devis
  const urgence = urgenceChantier(projet)
  const age = ancienneteLabel(projet.recu_le)
  const nonLus = projet.non_lus ?? 0
  const depliable = onToggle != null
  const nouveau = estNouveau(projet)

  const titre =
    signe && projet.client_nom ? (
      projet.client_nom
    ) : (
      <span className="flex items-center gap-1 italic text-muted-foreground">
        <Lock className="size-3.5 shrink-0" /> Client confidentiel
      </span>
    )

  return (
    <div
      className={cn(
        'flex items-center gap-3',
        compact ? 'p-3' : 'p-4 pl-5 sm:p-5 sm:pl-6',
        depliable && 'cursor-pointer transition-colors hover:bg-accent/40',
      )}
      onClick={depliable ? onToggle : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate font-display tracking-tight',
              compact ? 'text-sm' : 'text-base',
            )}
          >
            {titre}
          </span>
          {projet.client_ville && (
            <span className="flex min-w-0 items-center gap-0.5 text-sm text-foreground/70">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{projet.client_ville}</span>
            </span>
          )}
          {/* Un chantier tout juste reçu n'a encore déclenché aucune règle
              d'urgence : sans marqueur, il se noie parmi les anciens. */}
          {nouveau && (
            <span className="rounded-full bg-[#0EA5E9] px-2 py-0.5 text-xs font-semibold text-white">
              Nouveau
            </span>
          )}
          {nonLus > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {nonLus} message{nonLus > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="truncate">{metiers.join(', ')}</span>
          {!compact && <StatutBadge statut={projet.statut} />}
          {age && <span className="text-xs">· reçu {age}</span>}
        </p>

        {urgence.raison && (
          <p
            className={cn(
              'mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
              COULEUR_URGENCE[urgence.niveau],
            )}
          >
            {urgence.niveau === 'critique' && <AlertTriangle className="size-3" />}
            {urgence.raison}
          </p>
        )}

        {compact && montant != null && (
          <p className="montant mt-1.5 text-sm font-semibold">{formatEuros(montant)}</p>
        )}
      </div>

      {!compact && (
        <div className="flex shrink-0 items-center gap-3">
          {montant != null && (
            <span className="montant hidden text-sm font-semibold sm:block">
              {formatEuros(montant)}
            </span>
          )}
          {depliable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggle?.()
              }}
              aria-expanded={ouvert}
              aria-label={ouvert ? 'Replier le chantier' : 'Déplier le chantier'}
              className={cn(
                'flex size-8 items-center justify-center rounded-full transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ouvert ? 'rotate-180 bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              <ChevronDown className="size-5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Liseré vertical coloré par statut, commun à toutes les vues. */
export function LisereStatut({ statut }: { statut: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-1"
      style={{ background: statutInfo(statut).color }}
    />
  )
}
