import { distanceKm } from '@/lib/geocoding'
import type { Artisan, Projet } from '@/types/database'

export interface ArtisanCompatible {
  artisan: Artisan
  distance: number | null // km depuis le client, null si coordonnées manquantes
  dansRayon: boolean | null // true/false si distance + rayon connus, sinon null
}

/**
 * Renvoie les artisans compatibles avec un projet :
 *  - exerçant AU MOINS UN des métiers demandés (un projet peut en avoir plusieurs) ;
 *  - triés par proximité du client (les plus proches d'abord),
 *    ceux sans coordonnées étant placés à la fin.
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
    .filter((a) =>
      // Pas (encore) de métier sur le projet (ex. prospect rapide) → on propose
      // tous les artisans (triés par proximité). Sinon, intersection des métiers.
      projet.metiers.length === 0
        ? true
        : a.metiers.some((m) => projet.metiers.includes(m)),
    )
    .map((a) => {
      const distance =
        client && a.latitude != null && a.longitude != null
          ? distanceKm(client, { lat: a.latitude, lon: a.longitude })
          : null
      const dansRayon =
        distance != null && a.rayon_km != null ? distance <= a.rayon_km : null
      return { artisan: a, distance, dansRayon }
    })
    .sort((x, y) => {
      if (x.distance == null) return 1
      if (y.distance == null) return -1
      return x.distance - y.distance
    })
}
