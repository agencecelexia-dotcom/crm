// Les photos de rue autour d'une maison : Panoramax (ouvert, soutenu par
// l'IGN, sans clé) et Mapillary (Meta, clé gratuite). Sans Deno : fetch
// seulement, pour la fonction, les scripts et les tests.
//
// Google Street View n'y est pas, et n'y sera pas : ses conditions
// d'utilisation interdisent d'en tirer des mesures ou de le soumettre à une IA.

export interface PhotoRue {
  source: 'panoramax' | 'mapillary'
  id: string
  lon: number
  lat: number
  /** Cap du centre de l'image (degrés depuis le nord), s'il est connu. */
  cap: number | null
  /** Champ horizontal (degrés) ; 360 pour une photo panoramique. */
  champ: number
  largeur: number
  hauteur: number
  /** Prise de vue (ISO). */
  date: string | null
  auteur: string | null
  /** Licence, à citer avec l'auteur. */
  licence: string
  /** L'image à analyser et à montrer (environ 2 000 px de large). */
  url: string
  /** La page publique de la photo. */
  page: string | null
}

const PANORAMAX = 'https://api.panoramax.xyz/api'
const MAPILLARY = 'https://graph.mapillary.com'

/** Un carré de ±`m` mètres autour d'un point, en degrés. */
function carre(lon: number, lat: number, m: number): [number, number, number, number] {
  const dLat = m / 111320
  const dLon = m / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

async function lire(url: string, essais = 2): Promise<unknown> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`http_${r.status}`)
      return await r.json()
    } catch (e) {
      derniere = e
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)))
    }
  }
  throw derniere instanceof Error ? derniere : new Error('injoignable')
}

interface ItemPanoramax {
  id?: string
  collection?: string
  geometry?: { coordinates?: number[] }
  properties?: {
    datetime?: string
    'view:azimuth'?: number | null
    'pers:interior_orientation'?: { field_of_view?: number | null; sensor_array_dimensions?: number[] | null }
    license?: string
    'geovisio:producer'?: string
  }
  assets?: Record<string, { href?: string } | undefined>
  providers?: { name?: string; roles?: string[] }[]
  links?: { rel?: string; href?: string }[]
}

/** Lit un élément de recherche Panoramax ; null s'il est inutilisable. */
export function photoPanoramax(f: ItemPanoramax): PhotoRue | null {
  const c = f.geometry?.coordinates
  const url = f.assets?.sd?.href ?? f.assets?.hd?.href
  if (!f.id || !c || c.length < 2 || !url) return null
  const o = f.properties?.['pers:interior_orientation']
  const dims = o?.sensor_array_dimensions
  const champ = o?.field_of_view ?? null
  // Les dérivées « sd » font 2 048 px de large, proportions du capteur conservées.
  const largeur = 2048
  const hauteur = dims && dims[0] > 0 ? Math.round((2048 * dims[1]) / dims[0]) : 1536
  return {
    source: 'panoramax',
    id: f.id,
    lon: c[0],
    lat: c[1],
    cap: f.properties?.['view:azimuth'] ?? null,
    // Sans champ connu, un téléphone voit environ 65° en largeur.
    champ: champ && champ > 0 ? champ : 65,
    largeur,
    hauteur,
    date: f.properties?.datetime ?? null,
    auteur: f.providers?.find((p) => p.roles?.includes('producer'))?.name ?? f.properties?.['geovisio:producer'] ?? null,
    licence: f.properties?.license ?? 'CC-BY-SA-4.0',
    url,
    page: f.collection ? `https://api.panoramax.xyz/#focus=pic&pic=${f.id}` : null,
  }
}

/** Les photos Panoramax à moins de `rayon` mètres d'un point. */
export async function photosPanoramax(lon: number, lat: number, rayon = 60): Promise<PhotoRue[]> {
  const b = carre(lon, lat, rayon).map((v) => v.toFixed(6)).join(',')
  const j = (await lire(`${PANORAMAX}/search?bbox=${b}&limit=200`)) as { features?: ItemPanoramax[] }
  return (j.features ?? []).map(photoPanoramax).filter((p): p is PhotoRue => !!p)
}

interface ItemMapillary {
  id?: string
  captured_at?: number
  compass_angle?: number
  computed_compass_angle?: number
  geometry?: { coordinates?: number[] }
  computed_geometry?: { coordinates?: number[] }
  camera_type?: string
  camera_parameters?: number[]
  width?: number
  height?: number
  thumb_2048_url?: string
  creator?: { username?: string }
}

/** Lit une image Mapillary ; null si elle est inutilisable. */
export function photoMapillary(f: ItemMapillary): PhotoRue | null {
  const c = f.computed_geometry?.coordinates ?? f.geometry?.coordinates
  if (!f.id || !c || c.length < 2 || !f.thumb_2048_url) return null
  const panoramique = f.camera_type === 'spherical' || f.camera_type === 'equirectangular'
  // La focale est rapportée au plus grand côté de l'image.
  const focale = f.camera_parameters?.[0]
  const w = f.width ?? 2048, h = f.height ?? 1536
  const champ = panoramique
    ? 360
    : focale && focale > 0
      ? (2 * Math.atan((w / Math.max(w, h)) / (2 * focale)) * 180) / Math.PI
      : 65
  const echelle = 2048 / Math.max(w, h)
  return {
    source: 'mapillary',
    id: f.id,
    lon: c[0],
    lat: c[1],
    cap: f.computed_compass_angle ?? f.compass_angle ?? null,
    champ,
    largeur: Math.round(w * echelle),
    hauteur: Math.round(h * echelle),
    date: f.captured_at ? new Date(f.captured_at).toISOString() : null,
    auteur: f.creator?.username ?? null,
    licence: 'CC-BY-SA-4.0',
    url: f.thumb_2048_url,
    page: `https://www.mapillary.com/app/?pKey=${f.id}`,
  }
}

/** Les images Mapillary à moins de `rayon` mètres (clé gratuite requise). */
export async function photosMapillary(lon: number, lat: number, jeton: string, rayon = 60): Promise<PhotoRue[]> {
  const b = carre(lon, lat, rayon).map((v) => v.toFixed(6)).join(',')
  const champs = 'id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,camera_type,camera_parameters,width,height,thumb_2048_url,creator'
  const j = (await lire(
    `${MAPILLARY}/images?access_token=${encodeURIComponent(jeton)}&fields=${champs}&bbox=${b}&limit=200`,
  )) as { data?: ItemMapillary[] }
  return (j.data ?? []).map(photoMapillary).filter((p): p is PhotoRue => !!p)
}
