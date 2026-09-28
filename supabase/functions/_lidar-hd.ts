// Les dalles LiDAR HD de l'IGN : trouver celles d'une zone, et les lire par
// morceaux. Sans Deno : fetch seulement (fonctions, scripts, banc).

import type { LireOctets, Zone } from './_copc.ts'

export interface Dalle {
  /** Le nuage classé, au format COPC. */
  url: string
  /** Fin du vol : la maison peut avoir changé depuis. */
  vol: string | null
}

/**
 * Les dalles qui couvrent une zone (Lambert-93), d'après la couche de
 * métadonnées LiDAR HD de la Géoplateforme. Une maison sur dix environ est à
 * cheval sur deux dalles d'un kilomètre.
 */
export async function dallesPour(zone: Zone): Promise<Dalle[]> {
  const url =
    'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&TYPENAMES=IGNF_LIDAR-HD_METADONNEE:metadata&OUTPUTFORMAT=application/json&COUNT=8' +
    `&BBOX=${[zone.minX, zone.minY, zone.maxX, zone.maxY].map((v) => v.toFixed(2)).join(',')},EPSG:2154`
  const j = (await avecReessais(async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`metadonnees_${r.status}`)
    return r.json()
  })) as { features?: { properties?: { url_npl?: string; date_fin_acquisition?: string } }[] }
  return (j.features ?? [])
    .map((f) => ({ url: f.properties?.url_npl ?? '', vol: f.properties?.date_fin_acquisition?.slice(0, 10) ?? null }))
    .filter((d) => d.url.endsWith('.copc.laz'))
}

/**
 * Lire un fichier distant par plages d'octets (HTTP Range). Le serveur de
 * l'IGN répond en une à deux secondes et coupe parfois la connexion : délai de
 * garde, contrôle de la longueur reçue, réessais.
 */
export interface Journal {
  requetes: number
  octets: number
  /** Chaque lecture : taille demandée, durée, statut, tentative. */
  detail: { octets: number; ms: number; statut: number | string; essai: number }[]
}

export function lecteurHttp(url: string, journal?: Journal): LireOctets {
  return (debut, fin) => {
    let essai = 0
    return avecReessais(async () => {
      essai++
      const t = performance.now()
      let statut: number | string = 'erreur'
      try {
        const r = await fetch(url, { headers: { Range: `bytes=${debut}-${fin - 1}` }, signal: AbortSignal.timeout(30000) })
        statut = r.status
        if (r.status === 429) {
          // L'IGN limite le débit : on attend ce qu'il demande, sinon deux secondes.
          const attente = Number(r.headers.get('retry-after') ?? '2')
          await r.body?.cancel()
          await new Promise((ok) => setTimeout(ok, Math.min(10, Math.max(1, attente)) * 1000))
          throw new Error('plage_429')
        }
        if (r.status !== 206) throw new Error(`plage_${r.status}`)
        const octets = new Uint8Array(await r.arrayBuffer())
        if (octets.byteLength !== fin - debut) throw new Error('plage_incomplete')
        if (journal) {
          journal.requetes++
          journal.octets += octets.byteLength
        }
        return octets
      } finally {
        journal?.detail.push({ octets: fin - debut, ms: Math.round(performance.now() - t), statut, essai })
      }
    }, 5)
  }
}

async function avecReessais<T>(f: () => Promise<T>, essais = 4): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await f()
    } catch (e) {
      derniere = e
      await new Promise((ok) => setTimeout(ok, 700 * (i + 1)))
    }
  }
  throw derniere instanceof Error ? derniere : new Error('lidar_injoignable')
}
