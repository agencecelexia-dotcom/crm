import { Suspense, lazy } from 'react'

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
  return (
    <Suspense fallback={null}>
      <Feuille {...props} />
    </Suspense>
  )
}
