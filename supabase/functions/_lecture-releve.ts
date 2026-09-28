// Relever une maison depuis les services de l'IGN : son contour et ceux de
// ses voisins (BD TOPO), ses points (LiDAR HD), puis le calcul. Sans Deno :
// la fonction `releve-lidar`, la pré-mesure et le banc lisent ce code ; seul
// le décodeur LAZ est injecté (WebAssembly embarqué côté serveur, paquet npm
// côté scripts).

import { autour, lireJson, parCleabs } from './_batiment.ts'
import { depuisLambert93, versLambert93 } from './_calcul-toit.ts'
import { lireEntete, lirePoints, noeudsDansZone, type Decompresseur, type Nuage, type Zone } from './_copc.ts'
import type { Point } from './_geometrie.ts'
import { dallesPour, lecteurHttp, type Dalle, type Journal } from './_lidar-hd.ts'
import { encoderNuage } from './_nuage.ts'
import { releverBatiment, VERSION_RELEVE, type Releve } from './_releve.ts'

/** Autour de la maison : de quoi voir le sol, les voisins et le débord le plus large. */
export const MARGE_ZONE = 8

export function zoneAutour(contour: Point[], marge = MARGE_ZONE): Zone {
  const P = contour.map(([lon, lat]) => versLambert93(lon, lat))
  return {
    minX: Math.floor(Math.min(...P.map((p) => p[0])) - marge),
    minY: Math.floor(Math.min(...P.map((p) => p[1])) - marge),
    maxX: Math.ceil(Math.max(...P.map((p) => p[0])) + marge),
    maxY: Math.ceil(Math.max(...P.map((p) => p[1])) + marge),
  }
}

/** Ce qui a servi au relevé : de quoi le refaire sans rien relire à l'IGN. */
export interface EntreeGardee {
  version: number
  cleabs: string
  contour: Point[]
  voisins: { cleabs: string; contour: Point[] }[]
  routes: Point[][]
  zone: Zone
  dalles: { vol: string | null; fichier: string }[]
}

export type IssueReleve =
  | {
      statut: 'fait'
      releve: Releve
      entree: EntreeGardee
      /** Les points, au format compact de `_nuage.ts`. */
      extrait: Uint8Array
      octets: number
      requetes: number
    }
  | { statut: 'hors_couverture' | 'introuvable'; motif: string }

/**
 * Le contour de la maison et ceux des bâtiments qui touchent sa zone. Le
 * contour vient de la BD TOPO, jamais du navigateur : le relevé est gardé
 * pour tous les chantiers de cette maison.
 */
export async function maisonEtVoisins(
  cleabs: string,
  indice: Point | null,
): Promise<{ contour: Point[]; voisins: { cleabs: string; contour: Point[] }[] } | null> {
  const [maison] = await parCleabs([cleabs], indice ? [indice] : [])
  if (!maison) return null
  const zone = zoneAutour(maison.contour)
  const lon = maison.contour.reduce((s, p) => s + p[0], 0) / maison.contour.length
  const lat = maison.contour.reduce((s, p) => s + p[1], 0) / maison.contour.length
  const rayon = Math.hypot(zone.maxX - zone.minX, zone.maxY - zone.minY) / 2 + 2
  const touche = (c: Point[]) => {
    const P = c.map(([x, y]) => versLambert93(x, y))
    return (
      Math.min(...P.map((p) => p[0])) <= zone.maxX && Math.max(...P.map((p) => p[0])) >= zone.minX &&
      Math.min(...P.map((p) => p[1])) <= zone.maxY && Math.max(...P.map((p) => p[1])) >= zone.minY
    )
  }
  const voisins = (await autour([lon, lat], rayon))
    .filter((b) => b.cleabs !== cleabs && touche(b.contour))
    .map((b) => ({ cleabs: b.cleabs, contour: b.contour }))
  return { contour: maison.contour, voisins }
}

/** Ce qui n'est pas une rue devant une maison. */
const PAS_UNE_RUE = new Set(['Sentier', 'Escalier', 'Piste cyclable'])

/**
 * Les routes à moins de 40 m de la zone (BD TOPO) : de quoi dire quelle
 * façade donne sur la rue. Une panne n'empêche pas le relevé : sans routes, le
 * côté rue reste inconnu.
 */
export async function routesAutour(zone: Zone): Promise<Point[][]> {
  const [lon0, lat0] = depuisLambert93(zone.minX - 40, zone.minY - 40)
  const [lon1, lat1] = depuisLambert93(zone.maxX + 40, zone.maxY + 40)
  const f7 = (v: number) => v.toFixed(7)
  const url =
    'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&TYPENAMES=BDTOPO_V3:troncon_de_route&SRSNAME=CRS:84&OUTPUTFORMAT=application/json&COUNT=200' +
    `&CQL_FILTER=${encodeURIComponent(`BBOX(geometrie,${f7(lon0)},${f7(lat0)},${f7(lon1)},${f7(lat1)},'EPSG:4326')`)}`
  try {
    const j = (await lireJson(url)) as {
      features?: { properties?: { nature?: string }; geometry?: { type?: string; coordinates?: unknown } }[]
    }
    return (j.features ?? [])
      .filter((f) => !PAS_UNE_RUE.has(f.properties?.nature ?? ''))
      .flatMap((f) => {
        const g = f.geometry
        const lignes = (g?.type === 'MultiLineString' ? g.coordinates : [g?.coordinates]) as number[][][] | undefined
        return (lignes ?? [])
          .filter(Array.isArray)
          .map((l) => l.filter((p) => Array.isArray(p) && typeof p[0] === 'number').map((p) => [p[0], p[1]] as Point))
          .filter((l) => l.length >= 2)
      })
  } catch {
    return []
  }
}

/** Les points de la zone, sur toutes les dalles qui la couvrent. */
export async function lireNuage(
  zone: Zone,
  decompresser: Decompresseur,
  journal?: Journal,
): Promise<{ nuage: Nuage; nuages: Nuage[]; dalles: Dalle[] } | null> {
  const dalles = await dallesPour(zone)
  if (!dalles.length) return null
  const nuages: Nuage[] = []
  for (const d of dalles) {
    const lire = lecteurHttp(d.url, journal)
    const e = await lireEntete(lire)
    const noeuds = await noeudsDansZone(lire, e, zone)
    nuages.push((await lirePoints(lire, e, noeuds, decompresser, zone)).nuage)
  }
  return { nuage: fusionner(nuages), nuages, dalles }
}

function fusionner(nuages: Nuage[]): Nuage {
  if (nuages.length === 1) return nuages[0]
  const nb = nuages.reduce((s, n) => s + n.nb, 0)
  const sortie: Nuage = { x: new Float64Array(nb), y: new Float64Array(nb), z: new Float64Array(nb), classe: new Uint8Array(nb), nb }
  let k = 0
  for (const n of nuages) {
    sortie.x.set(n.x.subarray(0, n.nb), k)
    sortie.y.set(n.y.subarray(0, n.nb), k)
    sortie.z.set(n.z.subarray(0, n.nb), k)
    sortie.classe.set(n.classe.subarray(0, n.nb), k)
    k += n.nb
  }
  return sortie
}

/** Tout le relevé d'une maison, depuis l'IGN. */
export async function releverDepuisIgn(
  cleabs: string,
  indice: Point | null,
  decompresser: Decompresseur,
): Promise<IssueReleve> {
  const maison = await maisonEtVoisins(cleabs, indice)
  if (!maison) return { statut: 'introuvable', motif: 'batiment_introuvable' }
  const zone = zoneAutour(maison.contour)
  const journal: Journal = { requetes: 0, octets: 0, detail: [] }
  const [lu, routes] = await Promise.all([lireNuage(zone, decompresser, journal), routesAutour(zone)])
  if (!lu) return { statut: 'hors_couverture', motif: 'hors_couverture' }
  // Le vol le plus récent : c'est lui qui date ce qu'on a vu.
  const vol = lu.dalles.map((d) => d.vol).filter((v): v is string => !!v).sort().pop() ?? null
  const releve = releverBatiment({
    nuage: lu.nuage,
    zone,
    contour: maison.contour,
    voisins: maison.voisins.map((v) => v.contour),
    routes,
    vol,
  })
  return {
    statut: 'fait',
    releve,
    entree: {
      version: VERSION_RELEVE,
      cleabs,
      contour: maison.contour,
      voisins: maison.voisins,
      routes,
      zone,
      dalles: lu.dalles.map((d) => ({ vol: d.vol, fichier: d.url.split('/').pop() ?? d.url })),
    },
    extrait: encoderNuage(lu.nuages, zone),
    octets: journal.octets,
    requetes: journal.requetes,
  }
}
