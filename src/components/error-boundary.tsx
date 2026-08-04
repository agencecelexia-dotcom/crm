import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Frontière d'erreur. Sans elle, la moindre exception au rendu démonte tout
 * l'arbre React et laisse une page blanche, sans message ni recours.
 *
 * Le cas concret qui a motivé ce composant : `STATUTS[projet.statut]` sur une
 * page publique de signature de contrat. Un statut inconnu en base — colonne
 * `text` sans contrainte — suffisait à blanchir l'écran d'un artisan en train
 * de signer. Voir aussi `statutInfo()` dans lib/constants, qui traite la cause.
 *
 * À poser autour des routes ET individuellement autour de chaque page
 * publique, pour qu'un échec sur l'une n'emporte pas les autres.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { erreur: Error | null }
> {
  state: { erreur: Error | null } = { erreur: null }

  static getDerivedStateFromError(erreur: Error) {
    return { erreur }
  }

  componentDidCatch(erreur: Error) {
    // Pas d'outil de suivi d'erreurs branché pour l'instant : au moins laisser
    // une trace exploitable dans la console du navigateur.
    console.error('[ErrorBoundary]', erreur)
  }

  render() {
    if (!this.state.erreur) return this.props.children
    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </span>
        <div>
          <p className="font-display text-lg tracking-tight">Une erreur est survenue</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            La page n'a pas pu s'afficher. Rechargez pour réessayer — si le problème persiste,
            contactez Celexia.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Recharger la page</Button>
      </div>
    )
  }
}
