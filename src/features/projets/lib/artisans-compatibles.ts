import { distanceKm } from '@/lib/geocoding'
import type { Artisan, Projet } from '@/types/database'

export interface ArtisanCompatible {
  artisan: Artisan
  distance: number | null // km depuis le client, null si coordonnées manquantes
}

/**
 * Renvoie les artisans compatibles avec un projet :
 *  - exerçant le métier demandé ;
 *  - triés par proximité du client (les plus proches d'abord),
 *    ceux sans coordonnées étant placés à la fin.
 */
export function artisansCompatibles(
  projet: Pick<Projet, 'metier' | 'latitude' | 'longitude'>,
  artisans: Artisan[],
): ArtisanCompatible[] {
  const client =
    projet.latitude != null && projet.longitude != null
      ? { lat: projet.latitude, lon: projet.longitude }
      : null

  return artisans
    .filter((a) => a.metiers.includes(projet.metier))
    .map((a) => {
      const distance =
        client && a.latitude != null && a.longitude != null
          ? distanceKm(client, { lat: a.latitude, lon: a.longitude })
          : null
      return { artisan: a, distance }
    })
    .sort((x, y) => {
      if (x.distance == null) return 1
      if (y.distance == null) return -1
      return x.distance - y.distance
    })
}
