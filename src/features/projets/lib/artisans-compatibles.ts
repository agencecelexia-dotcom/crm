import { distanceKm } from '@/lib/geocoding'
import type { Artisan, Projet } from '@/types/database'

export interface ArtisanCompatible {
  artisan: Artisan
  distance: number | null // km depuis le client (= distance au SIÈGE, info seulement)
  couvre: boolean // couvre RÉELLEMENT la zone du projet (zones/départements déclarés)
  metierMatch: boolean // exerce au moins un des métiers demandés
}

// Département depuis le code postal client (45000 → 45 ; 97xxx → 971…).
function deptDeCp(cp?: string | null): string | null {
  const d = (cp ?? '').trim()
  if (!/^\d{5}$/.test(d)) return null
  return d.startsWith('97') || d.startsWith('98') ? d.slice(0, 3) : d.slice(0, 2)
}

/**
 * Renvoie TOUS les artisans pour un projet (aucun blocage), avec :
 *  - `couvre` : l'artisan dessert vraiment la zone du projet — selon ses zones
 *    DÉCLARÉES (départements ou villes+rayon), ou son rayon-domicile (legacy).
 *    Le siège ne suffit PAS : un artisan basé à Orléans qui ne déclare que l'IDF
 *    n'est pas « couvrant » pour un projet à Orléans.
 *  - `distance` : distance au siège (info / tri secondaire).
 * Tri : métier d'abord, puis ceux qui couvrent la zone, puis proximité du siège.
 */
export function artisansCompatibles(
  projet: Pick<Projet, 'metiers' | 'latitude' | 'longitude' | 'client_code_postal'>,
  artisans: Artisan[],
): ArtisanCompatible[] {
  const client =
    projet.latitude != null && projet.longitude != null
      ? { lat: projet.latitude, lon: projet.longitude }
      : null
  const dept = deptDeCp(projet.client_code_postal)

  return artisans
    .map((a) => {
      const distance =
        client && a.latitude != null && a.longitude != null
          ? distanceKm(client, { lat: a.latitude, lon: a.longitude })
          : null
      const parDept = !!dept && (a.departements_couverts ?? []).includes(dept)
      const parZone =
        !!client &&
        (a.zones_couvertes ?? []).some(
          (z) =>
            z.lat != null &&
            z.lon != null &&
            distanceKm(client, { lat: z.lat, lon: z.lon }) <= z.rayon_km,
        )
      const parRayon = distance != null && a.rayon_km != null && distance <= a.rayon_km
      const couvre = parDept || parZone || parRayon
      const metierMatch =
        projet.metiers.length === 0 || a.metiers.some((m) => projet.metiers.includes(m))
      return { artisan: a, distance, couvre, metierMatch }
    })
    .sort((x, y) => {
      if (x.metierMatch !== y.metierMatch) return x.metierMatch ? -1 : 1
      if (x.couvre !== y.couvre) return x.couvre ? -1 : 1
      if (x.distance == null) return 1
      if (y.distance == null) return -1
      return x.distance - y.distance
    })
}
