import { distanceKm } from '@/lib/geocoding'
import type { Artisan, Projet } from '@/types/database'

export interface ArtisanCompatible {
  artisan: Artisan
  distance: number | null // km depuis le client, null si coordonnées manquantes
  dansRayon: boolean | null // true/false si distance + rayon connus, sinon null
}

/**
 * Renvoie les artisans compatibles avec un projet :
 *  - exerçant le métier demandé ;
 *  - si un sous-métier précis est demandé, l'artisan doit le faire ;
 *  - triés par proximité du client (les plus proches d'abord),
 *    ceux sans coordonnées étant placés à la fin.
 */
export function artisansCompatibles(
  projet: Pick<Projet, 'metier' | 'sous_metier' | 'latitude' | 'longitude'>,
  artisans: Artisan[],
): ArtisanCompatible[] {
  const client =
    projet.latitude != null && projet.longitude != null
      ? { lat: projet.latitude, lon: projet.longitude }
      : null

  return artisans
    .filter((a) => {
      const faitLeMetier = a.metiers.includes(projet.metier)
      // Si un sous-métier précis est demandé, on exige qu'il le fasse.
      const faitLeSousMetier =
        !projet.sous_metier || a.sous_metiers.includes(projet.sous_metier)
      return faitLeMetier && faitLeSousMetier
    })
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
