import { AlertTriangle, ChevronDown, ChevronRight, Lock, MapPin } from 'lucide-react'

import { cn } from '@/lib/utils'
import { StatutArtisan } from './statut-artisan'
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
  /** Non fourni avec onToggle = ouverture du panneau latéral. */
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
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Lock className="size-3.5 shrink-0" /> Client confidentiel
      </span>
    )

  return (
    <div
      className={cn(
        'flex items-center gap-3',
        compact ? 'p-4' : 'p-4 sm:px-5 xl:min-h-24',
        depliable && 'cursor-pointer transition-colors hover:bg-muted/40',
      )}
      onClick={depliable ? onToggle : undefined}
    >
      <div className={cn('min-w-0 flex-1', !compact && 'xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)_minmax(0,1fr)] xl:items-center xl:gap-6')}>
        <div className={cn('flex flex-wrap items-center gap-2', !compact && 'xl:gap-x-2 xl:gap-y-1')}>
          <span
            className={cn(
              'min-w-0 break-words font-semibold text-foreground',
              compact ? 'text-sm' : 'text-base xl:w-full',
            )}
          >
            {titre}
          </span>
          {projet.client_ville && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{projet.client_ville}</span>
            </span>
          )}
          {/* Un chantier tout juste reçu n'a encore déclenché aucune règle
              d'urgence : sans marqueur, il se noie parmi les anciens. */}
          {nouveau && (
            <span className="text-xs font-medium text-primary">
              Nouveau
            </span>
          )}
          {nonLus > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {nonLus} message{nonLus > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <p className={cn('mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground', !compact && 'xl:mt-0 xl:flex-col xl:items-start xl:gap-2')}>
          <span className="break-words">{metiers.join(', ')}</span>
          {(!compact || projet.issue === 'gagne' || projet.issue === 'perdu') && <StatutArtisan statut={projet.statut} />}
          {compact && age && <span className="text-xs">· reçu {age}</span>}
        </p>

        <div className={cn(!compact && 'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 xl:mt-0 xl:flex-col xl:items-start')}>
          {urgence.raison && (
            <p
              className={cn(
                'inline-flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                compact && 'mt-2',
                COULEUR_URGENCE[urgence.niveau],
              )}
            >
              {urgence.niveau === 'critique' && <AlertTriangle className="mt-0.5 size-3 shrink-0" />}
              {urgence.raison}
            </p>
          )}
          {!compact && age && <span className="text-xs text-muted-foreground">Reçu {age}</span>}
        </div>

        {montant != null && (
          <p className={cn('montant mt-2 text-sm font-semibold', !compact && 'sm:hidden')}>
            {formatEuros(montant)}
          </p>
        )}
      </div>

      {!compact && (
        <div className="flex shrink-0 items-center justify-end gap-3 xl:w-36">
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
              aria-label={ouvert === undefined ? 'Ouvrir le chantier' : ouvert ? 'Replier le chantier' : 'Déplier le chantier'}
              className={cn(
                'flex size-11 items-center justify-center rounded-lg transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ouvert ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {ouvert === undefined ? (
                <ChevronRight className="size-5" />
              ) : (
                <ChevronDown className={cn('size-5 transition-transform', ouvert && 'rotate-180')} />
              )}
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
      className="absolute inset-y-0 left-0 w-0.5 opacity-60"
      style={{ background: statutInfo(statut).color }}
    />
  )
}
