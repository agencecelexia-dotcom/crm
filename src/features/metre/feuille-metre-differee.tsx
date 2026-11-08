import { Suspense, lazy, useEffect, useRef } from 'react'
import { ErrorBoundary } from '@/components/error-boundary'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * Le métré, chargé seulement quand on l'ouvre.
 *
 * Leaflet et le module de carte pèsent cent cinquante kilo-octets. L'espace
 * artisan est déjà différé, mais tout l'y empiler alourdirait son chargement
 * pour les trois quarts des artisans qui ne mesurent rien ce jour-là.
 */
const Feuille = lazy(() => import('./feuille-metre').then((m) => ({ default: m.FeuilleMetre })))

export function FeuilleMetreDifferee(props: {
  token: string
  affectationToken: string
  titre?: string | null
  onClose: () => void
}) {
  // L'historique est posé dès l'appui, même si le module de carte n'est pas
  // encore téléchargé. Retour ferme aussi l'état de chargement.
  const fermer = useRef(props.onClose)
  useEffect(() => { fermer.current = props.onClose })
  useEffect(() => {
    window.history.pushState({ ...window.history.state, feuilleMetre: true }, '')
    const retour = () => fermer.current()
    window.addEventListener('popstate', retour)
    return () => window.removeEventListener('popstate', retour)
  }, [])
  function fermerFeuille() {
    if (window.history.state?.feuilleMetre) window.history.back()
    else props.onClose()
  }
  return (
    <ErrorBoundary fallback={
      <Sheet open onOpenChange={(ouvert) => !ouvert && fermerFeuille()}>
        <SheetContent side="bottom" className="h-[95dvh]">
          <SheetHeader><SheetTitle>{props.titre || 'Métré'}</SheetTitle><SheetDescription>Les outils n’ont pas pu être chargés.</SheetDescription></SheetHeader>
          <p role="alert" className="py-6 text-sm">Vérifiez votre connexion puis rechargez la page pour réessayer.</p>
          <Button onClick={() => window.location.reload()}>Recharger la page</Button>
          <Button variant="outline" onClick={fermerFeuille}>Revenir aux chantiers</Button>
        </SheetContent>
      </Sheet>
    }>

    <Suspense fallback={
      <Sheet open onOpenChange={(ouvert) => !ouvert && fermerFeuille()}>
        <SheetContent side="bottom" className="h-[95dvh]">
          <SheetHeader><SheetTitle>{props.titre || 'Métré'}</SheetTitle><SheetDescription>Ouverture des outils de mesure</SheetDescription></SheetHeader>
          <p role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Chargement de la carte et des outils…</p>
        </SheetContent>
      </Sheet>
    }>
      <Feuille {...props} onClose={fermerFeuille} />
    </Suspense>
    </ErrorBoundary>
  )
}
