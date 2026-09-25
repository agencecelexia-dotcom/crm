import { aire, distance, longueur, murs, type Mur, type Point } from './_geometrie.ts'

/**
 * La parcelle cadastrale d'une maison, et ses côtés : ce que le poseur de
 * clôture chiffre.
 *
 * Le client dit « dix mètres » ; la parcelle en fait quatre-vingts de tour.
 * Le poseur coche les côtés à clôturer — le côté rue, le fond du jardin — et
 * lit leur somme. Chaque côté est un segment du plan cadastral, recollé quand
 * il est presque droit, comme les murs d'une maison.
 */
export interface Parcelle {
  /** Identifiant cadastral (commune, section, numéro). */
  id: string
  contour: Point[]
  surface: number
  perimetre: number
  cotes: Mur[]
}

const WFS = 'https://data.geopf.fr/wfs/ows'

/**
 * La parcelle qui contient le point — le centre de la maison.
 *
 * Le paramètre BBOX standard, comme pour le bâti : le filtre CQL de cette
 * couche ne connaît pas l'attribut « geometrie » et répond 400.
 */
export async function parcelleSous(p: Point, signal?: AbortSignal): Promise<Parcelle | null> {
  const d = 15 / 111320
  const dl = 15 / (111320 * Math.cos((p[1] * Math.PI) / 180))
  const url = new URL(WFS)
  url.searchParams.set('SERVICE', 'WFS')
  url.searchParams.set('VERSION', '2.0.0')
  url.searchParams.set('REQUEST', 'GetFeature')
  url.searchParams.set('TYPENAMES', 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle')
  url.searchParams.set('SRSNAME', 'CRS:84')
  url.searchParams.set('OUTPUTFORMAT', 'application/json')
  url.searchParams.set('COUNT', '30')
  url.searchParams.set('BBOX', `${[p[0] - dl, p[1] - d, p[0] + dl, p[1] + d].map((v) => v.toFixed(7)).join(',')},CRS:84`)
  const rep = await fetch(url, { signal })
  if (!rep.ok) throw new Error(`IGN ${rep.status}`)
  const j = (await rep.json()) as {
    features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[]
  }
  for (const f of j.features ?? []) {
    const contour = anneau(f.geometry)
    if (contour.length >= 3 && contient(contour, p)) return parcelleDe(String(f.properties?.idu ?? f.properties?.id ?? ''), contour)
  }
  return null
}

/** Une parcelle à partir de son contour : surface, tour, et côtés. */
export function parcelleDe(id: string, contour: Point[]): Parcelle {
  return { id, contour, surface: aire(contour), perimetre: longueur(contour, true), cotes: murs(contour) }
}

/** La longueur de clôture pour les côtés cochés. */
export function longueurCloture(p: Parcelle, cotes: Set<number>): number {
  return p.cotes.filter((c) => cotes.has(c.index)).reduce((s, c) => s + c.longueur, 0)
}

/**
 * Le côté de la parcelle le plus proche d'un point — l'adresse, qui tombe sur
 * la rue : c'est le côté rue, celui qu'on clôture le plus souvent.
 */
export function coteLePlusProche(p: Parcelle, point: Point): Mur | null {
  let meilleur: { c: Mur; d: number } | null = null
  for (const c of p.cotes) {
    const milieu: Point = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2]
    const d = distance(milieu, point)
    if (!meilleur || d < meilleur.d) meilleur = { c, d }
  }
  return meilleur?.c ?? null
}

function anneau(g?: { type?: string; coordinates?: unknown }): Point[] {
  const c = g?.coordinates as unknown[] | undefined
  if (!Array.isArray(c) || !c.length) return []
  const brut = (g?.type === 'MultiPolygon' ? (c[0] as unknown[])?.[0] : c[0]) as number[][] | undefined
  if (!Array.isArray(brut)) return []
  const pts = brut.filter((q) => Array.isArray(q) && typeof q[0] === 'number').map((q) => [q[0], q[1]] as Point)
  if (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop()
  return pts
}

/** Lancer de rayon, en degrés : suffisant à l'échelle d'une parcelle. */
function contient(P: Point[], p: Point): boolean {
  let dedans = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dedans = !dedans
  }
  return dedans
}

/**
 * Les côtés cochés, en tronçons continus le long de la parcelle, chacun en
 * ligne brisée. Deux côtés non voisins ne se relient pas : la ligne qui les
 * joindrait traverserait le terrain et fausserait la longueur.
 */
export function troncons(p: Parcelle, cotes: Set<number>): { cotes: Mur[]; ligne: Point[] }[] {
  const n = p.cotes.length
  if (!n || !cotes.size) return []
  const pris = p.cotes.map((c) => cotes.has(c.index))
  if (pris.every(Boolean)) {
    // Tout le tour : une seule ligne, refermée sur son départ.
    return [{ cotes: p.cotes, ligne: [...p.cotes.map((c) => c.a), p.cotes[0].a] }]
  }
  // On part d'un côté NON coché, pour ne pas couper un tronçon qui passe par le début de la liste.
  const depart = pris.findIndex((x) => !x)
  const sortie: { cotes: Mur[]; ligne: Point[] }[] = []
  let courant: Mur[] = []
  for (let k = 1; k <= n; k++) {
    const i = (depart + k) % n
    if (pris[i]) courant.push(p.cotes[i])
    else if (courant.length) {
      sortie.push({ cotes: courant, ligne: [courant[0].a, ...courant.map((c) => c.b)] })
      courant = []
    }
  }
  if (courant.length) sortie.push({ cotes: courant, ligne: [courant[0].a, ...courant.map((c) => c.b)] })
  return sortie
}
