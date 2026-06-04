import { distanceKm } from '@/lib/geocoding'
import type { Artisan, Projet } from '@/types/database'

export interface ArtisanCompatible {
  artisan: Artisan
  distance: number | null // km depuis le client, null si coordonnées manquantes
  dansRayon: boolean | null // true/false si distance + rayon connus, sinon null
  metierMatch: boolean // exerce au moins un des métiers demandés par le projet
}

/**
 * Renvoie TOUS les artisans pour un projet (aucun blocage par métier) :
 *  - on calcule `metierMatch` (exerce au moins un des métiers demandés) ;
 *  - tri : d'abord ceux dont le métier correspond, puis par proximité du client
 *    (les plus proches d'abord), ceux sans coordonnées étant placés à la fin.
 * Le métier ne sert donc plus qu'au classement/à l'info, pas à filtrer.
 */
export function artisansCompatibles(
  projet: Pick<Projet, 'metiers' | 'latitude' | 'longitude'>,
  artisans: Artisan[],
): ArtisanCompatible[] {
  const client =
    projet.latitude != null && projet.longitude != null
      ? { lat: projet.latitude, lon: projet.longitude }
      : null

  return artisans
    .map((a) => {
      const distance =
        client && a.latitude != null && a.longitude != null
          ? distanceKm(client, { lat: a.latitude, lon: a.longitude })
          : null
      const dansRayon =
        distance != null && a.rayon_km != null ? distance <= a.rayon_km : null
      // Pas de métier sur le projet (ex. prospect rapide) → on considère que tout
      // le monde correspond (aucune distinction à faire).
      const metierMatch =
        projet.metiers.length === 0 ||
        a.metiers.some((m) => projet.metiers.includes(m))
      return { artisan: a, distance, dansRayon, metierMatch }
    })
    .sort((x, y) => {
      // 1) métier correspondant d'abord
      if (x.metierMatch !== y.metierMatch) return x.metierMatch ? -1 : 1
      // 2) puis par proximité (coordonnées manquantes en dernier)
      if (x.distance == null) return 1
      if (y.distance == null) return -1
      return x.distance - y.distance
    })
}
