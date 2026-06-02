// ------------------------------------------------------------
//  Géocodage adresse → lat/lng via Nominatim (OpenStreetMap), gratuit, sans clé.
//  Règles respectées : 1 requête/seconde max (file d'attente sérialisée),
//  cache localStorage pour éviter les appels répétés, identification via param.
// ------------------------------------------------------------

const CACHE_KEY = 'celexia_geocache'
const MIN_INTERVALLE_MS = 1100 // un peu plus d'1 s entre 2 requêtes (politesse Nominatim)
// Contact identifiable (recommandé par la politique d'usage Nominatim).
const CONTACT_EMAIL = 'agence.celexia@gmail.com'

export interface Coordonnees {
  lat: number
  lon: number
}

type Cache = Record<string, Coordonnees | null>

function lireCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function ecrireCache(cache: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // quota plein : on ignore silencieusement
  }
}

// File d'attente : on enchaîne les requêtes en respectant l'intervalle minimum.
let dernierAppel = 0
let chaine: Promise<unknown> = Promise.resolve()

function planifier<T>(tache: () => Promise<T>): Promise<T> {
  const resultat = chaine.then(async () => {
    const attente = Math.max(0, MIN_INTERVALLE_MS - (Date.now() - dernierAppel))
    if (attente > 0) await new Promise((r) => setTimeout(r, attente))
    dernierAppel = Date.now()
    return tache()
  })
  // On garde la chaîne vivante même en cas d'erreur d'une tâche
  chaine = resultat.catch(() => undefined)
  return resultat
}

/** Construit une chaîne d'adresse exploitable par Nominatim. */
export function composerAdresse(parts: {
  adresse?: string | null
  code_postal?: string | null
  ville?: string | null
}): string {
  return [parts.adresse, parts.code_postal, parts.ville]
    .filter(Boolean)
    .join(', ')
    .trim()
}

/**
 * Géocode une adresse texte. Renvoie null si introuvable ou adresse vide.
 * Résultat mis en cache (y compris les "non trouvés" pour ne pas réinterroger).
 */
export async function geocoder(adresse: string): Promise<Coordonnees | null> {
  const requete = adresse.trim().toLowerCase()
  if (!requete) return null

  const cache = lireCache()
  if (requete in cache) return cache[requete]

  return planifier(async () => {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search')
      url.searchParams.set('q', adresse)
      url.searchParams.set('format', 'json')
      url.searchParams.set('limit', '1')
      url.searchParams.set('countrycodes', 'fr')
      url.searchParams.set('email', CONTACT_EMAIL)

      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null

      const data = (await res.json()) as Array<{ lat: string; lon: string }>
      const coord = data[0]
        ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
        : null

      const maj = lireCache()
      maj[requete] = coord
      ecrireCache(maj)
      return coord
    } catch {
      return null
    }
  })
}

/** Distance à vol d'oiseau (km) entre 2 points — formule de Haversine. */
export function distanceKm(
  a: Coordonnees,
  b: Coordonnees,
): number {
  const R = 6371 // rayon terrestre en km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
