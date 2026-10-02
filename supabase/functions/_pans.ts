// Les pans d'un toit, lus dans ses points LiDAR. Sans Deno ni réseau.
//
// POURQUOI PAN PAR PAN
//
// La grille d'altitudes de 50 cm donnait une pente par pixel, qu'on regroupait
// par orientation. Les points, eux, dessinent chaque pan comme un plan : sa
// pente exacte, son exposition, et surtout son étendue. La surface du toit est
// alors la SOMME DES PANS — chacun sa projection au sol, redressée de sa
// propre pente —, dans le contour réel du toit, débord compris.
//
// COMMENT
//
// 1. Chaque point reçoit une normale : le plan qui passe au mieux par ses
//    voisins à moins de 60 cm. Un point de faîtage ou de cheminée, pris entre
//    deux plans, s'y ajuste mal : il ne sert pas de graine.
// 2. On fait croître des régions à partir des points les plus plans : un
//    voisin les rejoint s'il est à moins de 12 cm de leur plan et que sa
//    normale ne s'en écarte pas de plus de 15°.
// 3. Deux régions voisines portées par le même plan n'en font qu'une.
// 4. Chaque point encore libre rejoint le pan voisin dont il est le plus près.
// 5. Le contour du toit est découpé en cases de 25 cm, chacune donnée au pan
//    de ses points (ou du plus proche, sous un arbre) : la surface de chaque
//    pan est sa part du contour, divisée par le cosinus de sa pente.

import type { Nuage } from './_copc.ts'
import { Grille2D } from './_nuage.ts'
import { aireL93, dansPolygone, estFeuillage, estToit, type Pt } from './_recalage.ts'

export interface PanToit {
  /** Du plus grand au plus petit. */
  id: number
  /** Le plan z = a·x + b·y + c, x et y en mètres depuis l'origine du relevé. */
  a: number
  b: number
  c: number
  /** Pente, en %. */
  pente: number
  /** Azimut de l'exposition (vers où le pan descend), 0 = nord, 90 = est. */
  azimut: number
  orientation: string
  /** Points du pan, et leur écart type au plan (m). */
  points: number
  ecart: number
  /** Surface projetée au sol, et surface vraie (m²). */
  airePlan: number
  aireVraie: number
  /** Part de la surface sans point de toit (sous un arbre), attribuée au pan voisin. */
  partReconstituee: number
  /** Contour simplifié du pan, en Lambert-93. */
  contour: Pt[]
  /**
   * Le même, tracé sur des étiquettes de cases lissées : c'est lui qu'on
   * dessine (carte, 3D). `contour` reste celui des calculs (hauteur d'un mur
   * au droit d'un pan) : le lisser changerait des chiffres du métré.
   */
  dessin: Pt[]
  /** Ce pan a été TRACÉ comme une terrasse (ou comme un pan de toit) : le relevé le suit, sans le deviner. */
  terrasseImposee?: boolean
}

/**
 * Les lignes d'un toit, ce que le couvreur chiffre au mètre :
 * - `faitage` : arête saillante horizontale (et le haut d'un toit à un pan) ;
 * - `aretier` : arête saillante en pente (la croupe) ;
 * - `noue` : arête rentrante (la gouttière entre deux pans) ;
 * - `egout` : bord bas du toit, où pend la gouttière ;
 * - `rive` : bord en pente, sur un pignon.
 */
export type TypeLigne = 'faitage' | 'aretier' | 'noue' | 'egout' | 'rive'

export interface LigneToit {
  type: TypeLigne
  /** Longueur vraie, pente comprise (m). */
  longueur: number
  /** Extrémités en plan (Lambert-93). */
  a: Pt
  b: Pt
  /** Les pans qu'elle borde (leurs numéros). */
  pans: number[]
  /**
   * Un bord À L'INTÉRIEUR du contour : le pan domine une surface plus basse
   * (terrasse, toit plus bas, cour) ; `bas` est l'altitude de cette surface.
   * Sous un tel égout se tient un mur en retrait.
   */
  interieur?: boolean
  bas?: number
}

export interface LecturePans {
  pans: PanToit[]
  lignes: LigneToit[]
  /** Points de toit qui ne tiennent à aucun pan : cheminées, antennes, bords. */
  pointsDivers: number
  /** Surface du contour du toit sans aucun point de toit (m²). */
  aireSansPoints: number
  /** Surface du contour qui n'est pas du toit : terrasse, cour, toit plus bas (m²). */
  aireHorsToit: number
  /** Le contour de ce qui est vraiment toit (l'union des pans), en Lambert-93. */
  contourToit: Pt[]
  /** Surfaces totales (m²). */
  airePlan: number
  aireVraie: number
  /**
   * La part des points de toit que le plan de leur pan explique à 12 cm près :
   * 1 = tout le toit tient dans les pans lus. La mesure qui dit si une
   * segmentation (automatique ou tracée) est juste, sans rien connaître d'autre.
   */
  explique: number
}

const CARDINAUX = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']
const cardinal = (az: number) => CARDINAUX[Math.round((((az % 360) + 360) % 360) / 45) % 8]

/** Un plan ajusté par moindres carrés sur des points (coordonnées locales). */
interface Plan {
  a: number
  b: number
  c: number
  ecart: number
}

function ajuster(ids: ArrayLike<number>, X: Float64Array, Y: Float64Array, Z: Float64Array): Plan | null {
  const n = ids.length
  if (n < 3) return null
  let mx = 0, my = 0, mz = 0
  for (let k = 0; k < n; k++) {
    const i = ids[k]
    mx += X[i]
    my += Y[i]
    mz += Z[i]
  }
  mx /= n
  my /= n
  mz /= n
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0
  for (let k = 0; k < n; k++) {
    const i = ids[k]
    const x = X[i] - mx, y = Y[i] - my, z = Z[i] - mz
    sxx += x * x
    sxy += x * y
    syy += y * y
    sxz += x * z
    syz += y * z
  }
  const det = sxx * syy - sxy * sxy
  // Des points alignés en plan (un mur, une arête) ne portent pas de plan.
  if (det < 1e-6 * n * n) return null
  const a = (sxz * syy - syz * sxy) / det
  const b = (syz * sxx - sxz * sxy) / det
  const c = mz - a * mx - b * my
  let r2 = 0
  for (let k = 0; k < n; k++) {
    const i = ids[k]
    const r = Z[i] - (a * X[i] + b * Y[i] + c)
    r2 += r * r
  }
  return { a, b, c, ecart: Math.sqrt(r2 / n) }
}

/** L'angle entre deux plans z = a·x + b·y + c, en degrés. */
function angle(p: { a: number; b: number }, q: { a: number; b: number }): number {
  const n1 = Math.hypot(p.a, p.b, 1), n2 = Math.hypot(q.a, q.b, 1)
  const cos = (p.a * q.a + p.b * q.b + 1) / (n1 * n2)
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI
}

/** Un pan TRACÉ (par l'IA ou l'artisan) : son contour en Lambert-93, et s'il est une terrasse. */
export interface PanImpose {
  polygone: Pt[]
  terrasse?: boolean
}

const RAYON_NORMALE = 0.6
const RAYON_VOISIN = 0.5
const DISTANCE_PLAN = 0.12
const ANGLE_MAX = 15
const ECART_GRAINE = 0.08
const POINTS_MIN = 20
const AIRE_PAN_MIN = 1
const PAS = 0.25

/**
 * Les pans du toit dont `toit` est le contour (débord compris, en Lambert-93).
 */
export function lirePans(nu: Nuage, h: Float32Array, toit: Pt[], mitoyens: boolean[] = [], imposes: PanImpose[] = []): LecturePans {
  const [x0, y0] = toit[0]
  // Les points de toit dans le contour, à 15 cm près (le bord lui-même).
  const ids: number[] = []
  for (let i = 0; i < nu.nb; i++) {
    if (!estToit(nu, h, i)) continue
    if (dansPolygone(nu.x[i], nu.y[i], toit) || distanceAuContour([nu.x[i], nu.y[i]], toit) < 0.15) ids.push(i)
  }
  const m = ids.length
  const X = new Float64Array(m), Y = new Float64Array(m), Z = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    X[k] = nu.x[ids[k]] - x0
    Y[k] = nu.y[ids[k]] - y0
    Z[k] = nu.z[ids[k]]
  }
  const tous = new Uint32Array(m).map((_, k) => k)
  const grille = new Grille2D(X, Y, tous, RAYON_VOISIN)

  const etiquette = new Int32Array(m).fill(-1)
  let regions: { ids: number[]; plan: Plan }[] = []
  // Le pan TRACÉ auquel correspond chaque région (quand les pans sont imposés).
  const imposeDe: number[] = []
  if (imposes.length) {
    // PANS IMPOSÉS : chaque polygone tracé prend les points de toit qu'il contient ; le plan
    // est ajusté dessus (les cheminées, lucarnes et branchages écartés). Pas de croissance
    // de régions : c'est le tracé, pas l'algorithme, qui dit où sont les pans.
    imposes.forEach((im, q) => {
      const P = im.polygone.map(([x, y]) => [x - x0, y - y0] as Pt)
      const membres: number[] = []
      for (let k = 0; k < m; k++) {
        if (etiquette[k] >= 0 || !dansPolygone(X[k], Y[k], P) || distanceAuContour([X[k], Y[k]], P) < 0.1) continue
        membres.push(k)
      }
      let plan: Plan | null = ajuster(membres, X, Y, Z)
      let bons = membres
      // Deux passes : le plan ajusté écarte ce qui s'en éloigne (cheminées, lucarnes, branchages), puis se réajuste.
      for (let tour = 0; tour < 3 && plan; tour++) {
        const courant: Plan = plan
        const seuil = Math.max(0.12, 2.2 * courant.ecart)
        const gardes = membres.filter((k) => Math.abs(Z[k] - (courant.a * X[k] + courant.b * Y[k] + courant.c)) <= seuil)
        if (gardes.length < POINTS_MIN) break
        bons = gardes
        plan = ajuster(gardes, X, Y, Z) ?? courant
      }
      if (!plan || bons.length < POINTS_MIN) return
      const r = regions.length
      for (const k of bons) etiquette[k] = r
      regions.push({ ids: bons, plan })
      imposeDe.push(q)
    })
  } else {
    // 1. Normales locales.
    const A = new Float64Array(m), B = new Float64Array(m), E = new Float64Array(m).fill(Infinity)
    for (let k = 0; k < m; k++) {
      const p = ajuster(grille.autour(X[k], Y[k], RAYON_NORMALE), X, Y, Z)
      if (!p) continue
      A[k] = p.a
      B[k] = p.b
      E[k] = p.ecart
    }

    // 2. Croissance de régions, des points les plus plans aux moins plans.
    const graines = [...tous].filter((k) => E[k] < ECART_GRAINE).sort((p, q) => E[p] - E[q])
    for (const g of graines) {
      if (etiquette[g] >= 0) continue
      const r = regions.length
      let plan: Plan = { a: A[g], b: B[g], c: Z[g] - A[g] * X[g] - B[g] * Y[g], ecart: E[g] }
      const membres = [g]
      etiquette[g] = r
      let prochainAjustement = 12
      for (let q = 0; q < membres.length; q++) {
        const k = membres[q]
        for (const j of grille.autour(X[k], Y[k], RAYON_VOISIN)) {
          if (etiquette[j] !== -1) continue
          if (Math.abs(Z[j] - (plan.a * X[j] + plan.b * Y[j] + plan.c)) > DISTANCE_PLAN) continue
          if (E[j] < ECART_GRAINE && angle({ a: A[j], b: B[j] }, plan) > ANGLE_MAX) continue
          etiquette[j] = r
          membres.push(j)
          if (membres.length >= prochainAjustement) {
            plan = ajuster(membres, X, Y, Z) ?? plan
            prochainAjustement = Math.ceil(membres.length * 1.5)
          }
        }
      }
      if (membres.length < POINTS_MIN) {
        // Trop petit pour un pan : ses points restent libres (mais ne resservent pas de graine).
        for (const k of membres) etiquette[k] = -2
        continue
      }
      regions.push({ ids: membres, plan: ajuster(membres, X, Y, Z) ?? plan })
    }
    for (let k = 0; k < m; k++) if (etiquette[k] === -2) etiquette[k] = -1

    // 3. Fusionner les régions voisines portées par le même plan.
    regions = fusionner(regions, etiquette, grille, X, Y, Z)

  }

  // 4. Les points libres (et ceux des arêtes) rejoignent le pan voisin le plus proche.
  for (let passe = 0; passe < 2; passe++) {
    const nouvelle = etiquette.slice()
    for (let k = 0; k < m; k++) {
      let meilleur = -1, dMin = 0.15
      for (const j of grille.autour(X[k], Y[k], RAYON_NORMALE)) {
        const r = etiquette[j]
        if (r < 0) continue
        const p = regions[r].plan
        const d = Math.abs(Z[k] - (p.a * X[k] + p.b * Y[k] + p.c))
        if (d < dMin) {
          dMin = d
          meilleur = r
        }
      }
      if (meilleur >= 0) nouvelle[k] = meilleur
    }
    etiquette.set(nouvelle)
  }
  regions = regions.map((r, i) => {
    const membres: number[] = []
    for (let k = 0; k < m; k++) if (etiquette[k] === i) membres.push(k)
    return { ids: membres, plan: ajuster(membres, X, Y, Z) ?? r.plan }
  })

  // 5. Le contour du toit en cases, chacune à un pan.
  const decoupe = decouper(toit, x0, y0, regions.map((r) => r.plan), etiquette, X, Y, Z, nu, h, mitoyens)
  const aireTotale = aireL93(toit)
  const pans: PanToit[] = []
  // La région de chaque pan : les lignes y sont rattachées avant la numérotation.
  const regionDe = new Map<PanToit, number>()
  regions.forEach((r, i) => {
    const cases = decoupe.parPan[i]
    const airePlan = decoupe.total ? (aireTotale * cases) / decoupe.total : 0
    if (airePlan < AIRE_PAN_MIN || r.ids.length < POINTS_MIN) return
    const { a, b, c, ecart } = r.plan
    const pente = Math.hypot(a, b)
    const pan: PanToit = {
      id: 0,
      a,
      b,
      c,
      pente: Math.round(pente * 1000) / 10,
      azimut: Math.round(((((Math.atan2(-a, -b) * 180) / Math.PI) % 360) + 360) % 360),
      orientation: pente < 0.05 ? 'plat' : cardinal((Math.atan2(-a, -b) * 180) / Math.PI),
      points: r.ids.length,
      ecart: Math.round(ecart * 1000) / 1000,
      airePlan,
      aireVraie: airePlan * Math.sqrt(1 + a * a + b * b),
      partReconstituee: cases ? decoupe.reconstituees[i] / cases : 0,
      contour: decoupe.contours[i].map(([x, y]) => [x + x0, y + y0] as Pt),
      dessin: decoupe.dessins[i].map(([x, y]) => [x + x0, y + y0] as Pt),
      ...(imposes.length ? { terrasseImposee: imposes[imposeDe[i]]?.terrasse === true } : {}),
    }
    regionDe.set(pan, i)
    pans.push(pan)
  })
  pans.sort((p, q) => q.aireVraie - p.aireVraie)
  pans.forEach((p, i) => (p.id = i + 1))
  // Les cases des pans écartés (trop petits) restent comptées : on répartit
  // leur surface au prorata, pour que la somme des pans égale le contour.
  // Ce qui n'est pas toit (terrasse, cour) sort du compte ; le reste du
  // contour est réparti entre les pans gardés.
  const aireToit = decoupe.total ? (aireTotale * (decoupe.total - decoupe.horsToit)) / decoupe.total : 0
  const sommePlan = pans.reduce((s, p) => s + p.airePlan, 0)
  const k = sommePlan ? aireToit / sommePlan : 1
  for (const p of pans) {
    p.airePlan = Math.round(p.airePlan * k * 10) / 10
    p.aireVraie = Math.round(p.aireVraie * k * 10) / 10
    p.partReconstituee = Math.round(p.partReconstituee * 100) / 100
  }
  let libres = 0
  for (let q = 0; q < m; q++) if (etiquette[q] < 0) libres++
  // Les lignes, rattachées aux pans gardés ; une ligne qui ne borde plus
  // aucun pan (trop petit, écarté) disparaît.
  const idDe = new Map(pans.map((p) => [regionDe.get(p)!, p.id]))
  const lignes: LigneToit[] = decoupe.lignes
    .map((l) => ({
      type: l.type,
      longueur: Math.round(l.longueur * 100) / 100,
      a: [l.a[0] + x0, l.a[1] + y0] as Pt,
      b: [l.b[0] + x0, l.b[1] + y0] as Pt,
      pans: l.regions.map((r) => idDe.get(r)).filter((v): v is number => v !== undefined),
      ...(l.interieur ? { interieur: true, bas: Math.round((l.bas ?? 0) * 100) / 100 } : {}),
    }))
    .filter((l) => l.pans.length > 0)
  return {
    pans,
    lignes,
    pointsDivers: libres,
    aireSansPoints: Math.round(decoupe.sansPoints * PAS * PAS * 10) / 10,
    aireHorsToit: Math.round((aireTotale - aireToit) * 10) / 10,
    contourToit: decoupe.contourToit.map(([x, y]) => [x + x0, y + y0] as Pt),
    airePlan: Math.round(pans.reduce((s, p) => s + p.airePlan, 0) * 10) / 10,
    aireVraie: Math.round(pans.reduce((s, p) => s + p.aireVraie, 0) * 10) / 10,
    explique: expliques(regions, etiquette, X, Y, Z),
  }
}

/** La part des points rattachés à un pan qui sont à moins de 12 cm de son plan, sur tous les points de toit. */
function expliques(regions: { plan: Plan }[], etiquette: Int32Array, X: Float64Array, Y: Float64Array, Z: Float64Array): number {
  if (!etiquette.length) return 0
  let bons = 0
  for (let k = 0; k < etiquette.length; k++) {
    const r = etiquette[k]
    if (r < 0 || !regions[r]) continue
    const p = regions[r].plan
    if (Math.abs(Z[k] - (p.a * X[k] + p.b * Y[k] + p.c)) <= 0.12) bons++
  }
  return Math.round((1000 * bons) / etiquette.length) / 1000
}

function distanceAuContour(p: Pt, P: Pt[]): number {
  let d = Infinity
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    d = Math.min(d, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)))
  }
  return d
}

/** Union des régions voisines de même plan (moins de 7°, et à moins de 8 cm l'une de l'autre). */
function fusionner(
  regions: { ids: number[]; plan: Plan }[],
  etiquette: Int32Array,
  grille: Grille2D,
  X: Float64Array,
  Y: Float64Array,
  Z: Float64Array,
): { ids: number[]; plan: Plan }[] {
  const parent = regions.map((_, i) => i)
  const racine = (i: number): number => (parent[i] === i ? i : (parent[i] = racine(parent[i])))
  const voisines = new Set<string>()
  regions.forEach((r, i) => {
    for (const k of r.ids) {
      for (const j of grille.autour(X[k], Y[k], RAYON_VOISIN)) {
        const e = etiquette[j]
        if (e >= 0 && e !== i) voisines.add(i < e ? `${i}-${e}` : `${e}-${i}`)
      }
    }
  })
  for (const cle of voisines) {
    const [i, j] = cle.split('-').map(Number)
    const p = regions[i].plan, q = regions[j].plan
    if (angle(p, q) > 7) continue
    // Les points de chaque région, au plan de l'autre.
    let s = 0
    for (const k of regions[j].ids) s += Math.abs(Z[k] - (p.a * X[k] + p.b * Y[k] + p.c))
    for (const k of regions[i].ids) s += Math.abs(Z[k] - (q.a * X[k] + q.b * Y[k] + q.c))
    if (s / (regions[i].ids.length + regions[j].ids.length) > 0.08) continue
    parent[racine(j)] = racine(i)
  }
  const groupes = new Map<number, number[]>()
  regions.forEach((r, i) => {
    const g = racine(i)
    groupes.set(g, [...(groupes.get(g) ?? []), ...r.ids])
  })
  const sortie: { ids: number[]; plan: Plan }[] = []
  for (const ids of groupes.values()) {
    const plan = ajuster(ids, X, Y, Z)
    if (!plan) continue
    for (const k of ids) etiquette[k] = sortie.length
    sortie.push({ ids, plan })
  }
  return sortie
}

/**
 * Le contour du toit en cases de 25 cm, chacune donnée à un pan : celui de la
 * majorité de ses points, sinon celui de la case voisine la plus proche
 * (propagation en largeur). Les cases sans point de toit mais avec du
 * feuillage sont « reconstituées ».
 */
function decouper(
  toit: Pt[],
  x0: number,
  y0: number,
  plans: Plan[],
  etiquette: Int32Array,
  X: Float64Array,
  Y: Float64Array,
  Z: Float64Array,
  nu: Nuage,
  h: Float32Array,
  mitoyens: boolean[],
): {
  total: number
  parPan: number[]
  reconstituees: number[]
  sansPoints: number
  horsToit: number
  contours: Pt[][]
  dessins: Pt[][]
  contourToit: Pt[]
  lignes: LigneBrute[]
} {
  const nbPans = plans.length
  const loc = toit.map(([x, y]) => [x - x0, y - y0] as Pt)
  const minX = Math.min(...loc.map((p) => p[0])), minY = Math.min(...loc.map((p) => p[1]))
  const maxX = Math.max(...loc.map((p) => p[0])), maxY = Math.max(...loc.map((p) => p[1]))
  const nx = Math.ceil((maxX - minX) / PAS) + 1, ny = Math.ceil((maxY - minY) / PAS) + 1
  const dedans = new Uint8Array(nx * ny)
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      if (dansPolygone(minX + (cx + 0.5) * PAS, minY + (cy + 0.5) * PAS, loc)) dedans[cy * nx + cx] = 1
    }
  }
  // Vote des points par case.
  const votes = new Map<number, Map<number, number>>()
  for (let k = 0; k < etiquette.length; k++) {
    if (etiquette[k] < 0) continue
    const cx = Math.floor((X[k] - minX) / PAS), cy = Math.floor((Y[k] - minY) / PAS)
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
    const c = cy * nx + cx
    const v = votes.get(c) ?? new Map<number, number>()
    v.set(etiquette[k], (v.get(etiquette[k]) ?? 0) + 1)
    votes.set(c, v)
  }
  // La hauteur moyenne des points de chaque case : elle dit, près d'une
  // limite, de quel plan la case est vraiment.
  const zCase = new Float64Array(nx * ny).fill(NaN)
  {
    const somme = new Float64Array(nx * ny), nb = new Uint16Array(nx * ny)
    for (let k = 0; k < Z.length; k++) {
      const cx = Math.floor((X[k] - minX) / PAS), cy = Math.floor((Y[k] - minY) / PAS)
      if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
      somme[cy * nx + cx] += Z[k]
      nb[cy * nx + cx]++
    }
    for (let c = 0; c < zCase.length; c++) if (nb[c]) zCase[c] = somme[c] / nb[c]
  }
  const pan = new Int32Array(nx * ny).fill(-1)
  const vues = new Uint8Array(nx * ny)
  for (const [c, v] of votes) {
    let meilleur = -1, n = 0
    for (const [r, k] of v) if (k > n) [meilleur, n] = [r, k]
    pan[c] = meilleur
    vues[c] = 1
  }
  // Les cases de feuillage : ce qu'un arbre cache.
  const feuillage = new Uint8Array(nx * ny)
  for (let i = 0; i < nu.nb; i++) {
    if (!estFeuillage(nu, h, i)) continue
    const cx = Math.floor((nu.x[i] - x0 - minX) / PAS), cy = Math.floor((nu.y[i] - y0 - minY) / PAS)
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) feuillage[cy * nx + cx] = 1
  }
  // CE QUI N'EST PAS LE TOIT. Le contour du cadastre comprend parfois une
  // terrasse, un perron, une cour couverte : aucun point de toit n'y tombe,
  // mais on y voit une surface nettement plus basse. Une case où le point le
  // plus bas (hors végétation) passe à plus de 80 cm sous le plan d'un pan
  // n'appartient pas à ce pan : sans cela, la propagation prolongeait le pan
  // voisin sur la terrasse (Nogent-sur-Marne, 20 m² de trop).
  const zBas = new Float64Array(nx * ny).fill(Infinity)
  for (let i = 0; i < nu.nb; i++) {
    const cl = nu.classe[i]
    if (cl >= 3 && cl <= 5) continue
    const cx = Math.floor((nu.x[i] - x0 - minX) / PAS), cy = Math.floor((nu.y[i] - y0 - minY) / PAS)
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
    const c = cy * nx + cx
    if (nu.z[i] < zBas[c]) zBas[c] = nu.z[i]
  }
  const sousLePlan = (d: number, r: number) => {
    if (!Number.isFinite(zBas[d])) return false
    const dx = d % nx, dy = (d - dx) / nx
    const x = minX + (dx + 0.5) * PAS, y = minY + (dy + 0.5) * PAS
    return zBas[d] < plans[r].a * x + plans[r].b * y + plans[r].c - 0.8
  }
  // Au bord d'un toit, le laser touche aussi le mur sous le débord : ces
  // points bas ne disent rien tant qu'un point de toit est dans la case
  // voisine. Seule une case entourée de cases sans toit peut être écartée.
  const presDuToit = new Uint8Array(nx * ny)
  for (let c = 0; c < vues.length; c++) {
    if (!vues[c]) continue
    const cx = c % nx, cy = (c - cx) / nx
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy
        if (x >= 0 && y >= 0 && x < nx && y < ny) presDuToit[y * nx + x] = 1
      }
    }
  }
  // Propagation aux cases sans vote, dans le contour.
  let front: number[] = []
  for (let c = 0; c < pan.length; c++) if (pan[c] >= 0) front.push(c)
  while (front.length) {
    const suivant: number[] = []
    for (const c of front) {
      const cx = c % nx, cy = (c - cx) / nx
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue
        const d = y * nx + x
        if (pan[d] >= 0 || !dedans[d]) continue
        if (!presDuToit[d] && sousLePlan(d, pan[c])) continue
        pan[d] = pan[c]
        suivant.push(d)
      }
    }
    front = suivant
  }
  const centre = (cx: number, cy: number): Pt => [minX + (cx + 0.5) * PAS, minY + (cy + 0.5) * PAS]
  const sens = redresser(pan, dedans, nx, ny, plans, centre, zCase)
  const lignes = [
    ...aretesEntrePans(pan, dedans, nx, ny, plans, sens, centre, loc),
    ...bordsDuToit(loc, mitoyens, pan, dedans, nx, ny, minX, minY, plans),
    ...bordsInterieurs(pan, dedans, nx, ny, minX, minY, plans, zBas),
  ]

  // Une case est « vue » s'il y a un point de toit à moins de 50 cm : à 15
  // points par m², une case de 25 cm sur trois est vide sans rien cacher.
  const proche = new Uint8Array(nx * ny)
  for (let c = 0; c < vues.length; c++) {
    if (!vues[c]) continue
    const cx = c % nx, cy = (c - cx) / nx
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy
        if (x >= 0 && y >= 0 && x < nx && y < ny) proche[y * nx + x] = 1
      }
    }
  }
  const parPan = new Array(nbPans).fill(0), reconstituees = new Array(nbPans).fill(0)
  let total = 0, sansPoints = 0, horsToit = 0
  for (let c = 0; c < pan.length; c++) {
    if (!dedans[c]) continue
    total++
    // Une case sans point de toit alentour : sous un arbre, ou sous des
    // panneaux (le verre sombre ne renvoie pas le laser).
    if (!proche[c]) {
      sansPoints++
      if (pan[c] >= 0 && feuillage[c]) reconstituees[pan[c]]++
    }
    if (pan[c] >= 0) parPan[pan[c]]++
    else horsToit++
  }
  // Le DESSIN des pans part d'une copie lissée des étiquettes : les surfaces,
  // elles, se comptent sur les étiquettes brutes (`parPan`) — le lissage ne
  // change aucun chiffre du métré.
  const lisse = lisser(pan, dedans, nx, ny)
  const contours: Pt[][] = [], dessins: Pt[][] = []
  for (let r = 0; r < nbPans; r++) {
    contours.push(contourDeCases(pan, dedans, nx, ny, r).map(([cx, cy]) => [minX + cx * PAS, minY + cy * PAS] as Pt))
    dessins.push(contourDeCases(lisse, dedans, nx, ny, r).map(([cx, cy]) => [minX + cx * PAS, minY + cy * PAS] as Pt))
  }
  // Le contour de ce qui est vraiment toit : l'union des pans.
  const toutPan = new Int32Array(pan.length).fill(-1)
  for (let c = 0; c < pan.length; c++) if (dedans[c] && pan[c] >= 0) toutPan[c] = 0
  const contourToit = contourDeCases(toutPan, dedans, nx, ny, 0).map(([cx, cy]) => [minX + cx * PAS, minY + cy * PAS] as Pt)
  return { total, parPan, reconstituees, sansPoints, horsToit, contours, dessins, contourToit, lignes }
}

/**
 * Redresser les limites entre pans : deux pans qui se rejoignent se coupent le
 * long de l'intersection de leurs plans. À un faîtage ou un arêtier (arête
 * saillante), le toit est le PLUS BAS des deux plans ; à une noue (arête
 * rentrante), le PLUS HAUT. Chaque case de la limite prend le pan que cette
 * règle désigne. Deux pans qui ne se rejoignent pas (une lucarne, un toit plus
 * bas contre un mur) gardent la limite des points.
 */
function redresser(
  pan: Int32Array,
  dedans: Uint8Array,
  nx: number,
  ny: number,
  plans: Plan[],
  centre: (cx: number, cy: number) => Pt,
  zCase: Float64Array,
): Map<string, number> {
  const z = (r: number, p: Pt) => plans[r].a * p[0] + plans[r].b * p[1] + plans[r].c
  // Les paires de pans voisins, et l'écart de hauteur le long de leur limite.
  const limites = new Map<string, number[]>()
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      const c = cy * nx + cx
      const A = pan[c]
      if (A < 0 || !dedans[c]) continue
      for (const d of [c + 1, c + nx]) {
        if ((d === c + 1 && cx + 1 >= nx) || d >= pan.length || !dedans[d]) continue
        const B = pan[d]
        if (B < 0 || B === A) continue
        const p = centre(cx, cy)
        const [i, j] = A < B ? [A, B] : [B, A]
        const cle = `${i}-${j}`
        const l = limites.get(cle)
        if (l) l.push(Math.abs(z(i, p) - z(j, p)))
        else limites.set(cle, [Math.abs(z(i, p) - z(j, p))])
      }
    }
  }
  // Saillante (+1) ou rentrante (−1), pour les pans qui se rejoignent vraiment.
  const sens = new Map<string, number>()
  for (const [cle, ecarts] of limites) {
    ecarts.sort((a, b) => a - b)
    if (ecarts[Math.floor(ecarts.length / 2)] > 0.25) continue
    const [i, j] = cle.split('-').map(Number)
    let s = 0
    for (let c = 0; c < pan.length; c++) {
      if (pan[c] !== i && pan[c] !== j) continue
      const cx = c % nx, p = centre(cx, (c - cx) / nx)
      // Dans son propre domaine, un pan est sous l'autre à une arête saillante.
      s += pan[c] === i ? z(j, p) - z(i, p) : z(i, p) - z(j, p)
    }
    sens.set(cle, s >= 0 ? 1 : -1)
  }
  if (!sens.size) return sens
  for (let passe = 0; passe < 16; passe++) {
    let change = 0
    const copie = pan.slice()
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const c = cy * nx + cx
        let A = copie[c]
        if (A < 0 || !dedans[c]) continue
        const p = centre(cx, cy)
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx, y = cy + dy
            if (x < 0 || y < 0 || x >= nx || y >= ny) continue
            const B = copie[y * nx + x]
            if (B < 0 || B === A) continue
            const sn = sens.get(A < B ? `${A}-${B}` : `${B}-${A}`)
            if (!sn) continue
            const d = z(B, p) - z(A, p)
            // Les points de la case ont le dernier mot : loin de la vraie
            // limite (au-delà du point où trois pans se rencontrent), ils
            // collent à leur plan, et la règle du plus bas ou du plus haut
            // ne s'applique plus.
            const zc = zCase[c]
            const accord = Number.isNaN(zc) || Math.abs(zc - z(B, p)) <= Math.abs(zc - z(A, p)) + 0.04
            if (accord && ((sn > 0 && d < -0.005) || (sn < 0 && d > 0.005))) A = B
          }
        }
        if (A !== pan[c]) {
          pan[c] = A
          change++
        }
      }
    }
    if (!change) break
  }
  return sens
}

/** Une ligne du toit, en coordonnées locales, rattachée aux régions (pas encore aux pans numérotés). */
interface LigneBrute {
  type: TypeLigne
  longueur: number
  a: Pt
  b: Pt
  regions: number[]
  interieur?: boolean
  bas?: number
}

/** Sous ce rapport entre la pente le long d'une ligne et celle du pan, la ligne est de niveau. */
const DE_NIVEAU = 0.35

/**
 * Faîtages, arêtiers et noues : là où deux pans qui se rejoignent se coupent.
 * La ligne est l'intersection de leurs plans ; sa longueur, l'étendue de leur
 * limite commune le long de cette ligne (coupée en morceaux si elle
 * s'interrompt plus d'un mètre), redressée de sa pente.
 */
function aretesEntrePans(
  pan: Int32Array,
  dedans: Uint8Array,
  nx: number,
  ny: number,
  plans: Plan[],
  sens: Map<string, number>,
  centre: (cx: number, cy: number) => Pt,
  contour: Pt[],
): LigneBrute[] {
  const milieux = new Map<string, Pt[]>()
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      const c = cy * nx + cx
      const A = pan[c]
      if (A < 0 || !dedans[c]) continue
      for (const [d, ox, oy] of [[c + 1, 1, 0], [c + nx, 0, 1]] as const) {
        if ((ox === 1 && cx + 1 >= nx) || d >= pan.length || !dedans[d]) continue
        const B = pan[d]
        if (B < 0 || B === A) continue
        const cle = A < B ? `${A}-${B}` : `${B}-${A}`
        if (!sens.has(cle)) continue
        const p = centre(cx, cy)
        const m: Pt = [p[0] + (ox * PAS) / 2, p[1] + (oy * PAS) / 2]
        const l = milieux.get(cle)
        if (l) l.push(m)
        else milieux.set(cle, [m])
      }
    }
  }
  const sortie: LigneBrute[] = []
  for (const [cle, pts] of milieux) {
    const [i, j] = cle.split('-').map(Number)
    const P = plans[i], Q = plans[j]
    const da = P.a - Q.a, db = P.b - Q.b, dc = P.c - Q.c
    const n2 = da * da + db * db
    if (n2 < 1e-6) continue
    const nn = Math.sqrt(n2)
    const u: Pt = [-db / nn, da / nn]
    const o: Pt = [(-dc * da) / n2, (-dc * db) / n2]
    const ts = pts
      .filter((m) => Math.abs((m[0] - o[0]) * da + (m[1] - o[1]) * db) / nn < 0.6)
      .map((m) => (m[0] - o[0]) * u[0] + (m[1] - o[1]) * u[1])
      .sort((x, y) => x - y)
    if (ts.length < 3) continue
    const pente = P.a * u[0] + P.b * u[1]
    const penteMax = Math.max(Math.hypot(P.a, P.b), Math.hypot(Q.a, Q.b), 1e-6)
    // Les points où un troisième pan, voisin des deux, coupe cette ligne.
    const jonctions: number[] = []
    for (let r = 0; r < plans.length; r++) {
      if (r === i || r === j) continue
      if (!sens.has(r < i ? `${r}-${i}` : `${i}-${r}`) || !sens.has(r < j ? `${r}-${j}` : `${j}-${r}`)) continue
      const R = plans[r]
      // P = Q et P = R : deux équations en (x, y).
      const a1 = da, b1 = db, c1 = -dc
      const a2 = P.a - R.a, b2 = P.b - R.b, c2 = -(P.c - R.c)
      const det = a1 * b2 - a2 * b1
      if (Math.abs(det) < 1e-9) continue
      const x = (c1 * b2 - c2 * b1) / det, y = (a1 * c2 - a2 * c1) / det
      jonctions.push((x - o[0]) * u[0] + (y - o[1]) * u[1])
    }
    const type: TypeLigne =
      (sens.get(cle) ?? 0) < 0 ? 'noue' : Math.abs(pente) / penteMax < DE_NIVEAU * 0.5 ? 'faitage' : 'aretier'
    // Morceaux : une interruption de plus d'un mètre (une lucarne, une cheminée) coupe la ligne.
    let debut = 0
    for (let k = 1; k <= ts.length; k++) {
      if (k < ts.length && ts[k] - ts[k - 1] <= 1) continue
      // Les bouts : au point où trois pans se rencontrent s'il est tout près,
      // sinon au bord du toit s'il est à moins de 70 cm, sinon une
      // demi-case au-delà du dernier point de limite.
      const bout = (t: number, sensT: number) => {
        const proches = jonctions.filter((tj) => Math.abs(tj - t) < 0.7)
        if (proches.length) return proches.reduce((a, b) => (Math.abs(a - t) < Math.abs(b - t) ? a : b))
        const p: Pt = [o[0] + u[0] * t, o[1] + u[1] * t]
        const d = croisementContour(p, [u[0] * sensT, u[1] * sensT], contour)
        return d !== null && d < 0.7 ? t + sensT * d : t + (sensT * PAS) / 2
      }
      let t0 = bout(ts[debut], -1)
      let t1 = bout(ts[k - 1], 1)
      // Au-delà du point où un troisième pan la coupe, une ligne ne continue
      // pas : un bout qui le dépasse de moins d'un mètre et demi y est ramené.
      for (const tj of jonctions) {
        if (tj > t0 && tj < t1 && tj - t0 < 1.5) t0 = tj
        if (tj > t0 && tj < t1 && t1 - tj < 1.5) t1 = tj
      }
      if (t1 - t0 >= 0.75 && k - debut >= 3) {
        sortie.push({
          type,
          longueur: (t1 - t0) * Math.sqrt(1 + pente * pente),
          a: [o[0] + u[0] * t0, o[1] + u[1] * t0],
          b: [o[0] + u[0] * t1, o[1] + u[1] * t1],
          regions: [i, j],
        })
      }
      debut = k
    }
  }
  return sortie
}

/**
 * Les bords d'un pan À L'INTÉRIEUR du contour : là où il domine d'au moins un
 * mètre une surface plus basse — une terrasse, un toit plus bas, une cour
 * couverte par le tracé du cadastre. Le contour du cadastre ne les voit pas ;
 * ce sont pourtant des égouts (gouttière au-dessus de la terrasse), et sous
 * eux se tient le vrai mur de la maison, en retrait.
 */
function bordsInterieurs(
  pan: Int32Array,
  dedans: Uint8Array,
  nx: number,
  ny: number,
  minX: number,
  minY: number,
  plans: Plan[],
  zBas: Float64Array,
): LigneBrute[] {
  const sortie: LigneBrute[] = []
  const z = (r: number, p: Pt) => plans[r].a * p[0] + plans[r].b * p[1] + plans[r].c
  // L'altitude de ce qu'on voit juste de l'autre côté du bord ; null si c'est du toit à la même hauteur.
  const dessous = (r: number, p: Pt): number | null => {
    const cx = Math.floor((p[0] - minX) / PAS), cy = Math.floor((p[1] - minY) / PAS)
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) return null
    const c = cy * nx + cx
    if (!dedans[c]) return null
    const autre = pan[c]
    const bas = autre >= 0 && autre !== r ? z(autre, p) : autre < 0 && Number.isFinite(zBas[c]) ? zBas[c] : null
    return bas !== null && z(r, p) - bas > 1 ? bas : null
  }
  for (let r = 0; r < plans.length; r++) {
    const P = plans[r]
    const penteMax = Math.hypot(P.a, P.b)
    if (penteMax < 0.05) continue
    const C = contourDeCases(pan, dedans, nx, ny, r).map(([cx, cy]) => [minX + cx * PAS, minY + cy * PAS] as Pt)
    // Chaque côté du contour du pan qui domine une surface plus basse. Le
    // contour suit les cases : un bord droit y arrive en petits morceaux,
    // recollés ensuite.
    const morceaux: { a: Pt; b: Pt; type: TypeLigne; bas: number }[] = []
    for (let i = 0; i < C.length; i++) {
      const a = C[i], b = C[(i + 1) % C.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.3) continue
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      // Le pan est à gauche du côté : l'extérieur, à droite.
      const n: Pt = [u[1], -u[0]]
      const bas = [0.25, 0.5, 0.75]
        .map((t) => dessous(r, [a[0] + (b[0] - a[0]) * t + n[0] * 0.4, a[1] + (b[1] - a[1]) * t + n[1] * 0.4]))
        .filter((v): v is number => v !== null)
      if (bas.length < 2) continue
      const le = P.a * u[0] + P.b * u[1]
      const dehors = P.a * n[0] + P.b * n[1]
      const type: TypeLigne | null = Math.abs(le) / penteMax >= DE_NIVEAU ? 'rive' : dehors < 0 ? 'egout' : null
      if (type) morceaux.push({ a, b, type, bas: bas.reduce((s, v) => s + v, 0) / bas.length })
    }
    // Recoller les morceaux qui se suivent, du même type, à moins de 25° l'un de l'autre.
    const lignes: { a: Pt; b: Pt; type: TypeLigne; bas: number[] }[] = []
    for (const m of morceaux) {
      const d = lignes[lignes.length - 1]
      const cap = (x: Pt, y: Pt) => Math.atan2(y[1] - x[1], y[0] - x[0])
      const ecartAngle = d ? Math.abs(((cap(m.a, m.b) - cap(d.a, d.b) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) : Infinity
      if (d && d.type === m.type && Math.hypot(m.a[0] - d.b[0], m.a[1] - d.b[1]) < 0.6 && ecartAngle < (25 * Math.PI) / 180) {
        d.b = m.b
        d.bas.push(m.bas)
      } else lignes.push({ a: m.a, b: m.b, type: m.type, bas: [m.bas] })
    }
    for (const l of lignes) {
      const L = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
      if (L < 1) continue
      const u: Pt = [(l.b[0] - l.a[0]) / L, (l.b[1] - l.a[1]) / L]
      const le = P.a * u[0] + P.b * u[1]
      sortie.push({
        type: l.type,
        longueur: L * Math.sqrt(1 + le * le),
        a: l.a,
        b: l.b,
        regions: [r],
        interieur: true,
        bas: l.bas.reduce((s, v) => s + v, 0) / l.bas.length,
      })
    }
  }
  return sortie
}

/** Distance, dans la direction `d`, du point `p` au premier côté du contour croisé ; null s'il n'en croise aucun. */
function croisementContour(p: Pt, d: Pt, contour: Pt[]): number | null {
  let min: number | null = null
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length]
    const ex = b[0] - a[0], ey = b[1] - a[1]
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-12) continue
    const wx = a[0] - p[0], wy = a[1] - p[1]
    const t = (wx * ey - wy * ex) / den
    const v = (wx * d[1] - wy * d[0]) / den
    if (t >= 0 && v >= 0 && v <= 1 && (min === null || t < min)) min = t
  }
  return min
}

/**
 * Égouts et rives : les bords du toit, pan par pan. Le long de chaque côté du
 * contour, on lit le pan juste à l'intérieur ; un bord de niveau où le pan
 * descend vers l'extérieur est un égout, un bord de niveau où il monte est le
 * haut d'un toit à un pan (faîtage), un bord en pente est une rive. Les murs
 * mitoyens n'ont ni égout ni rive ; un toit plat non plus.
 */
function bordsDuToit(
  loc: Pt[],
  mitoyens: boolean[],
  pan: Int32Array,
  dedans: Uint8Array,
  nx: number,
  ny: number,
  minX: number,
  minY: number,
  plans: Plan[],
): LigneBrute[] {
  const aire = loc.reduce((s, p, i) => {
    const q = loc[(i + 1) % loc.length]
    return s + p[0] * q[1] - q[0] * p[1]
  }, 0)
  const signe = aire > 0 ? 1 : -1
  const panEn = (p: Pt): number => {
    const cx = Math.floor((p[0] - minX) / PAS), cy = Math.floor((p[1] - minY) / PAS)
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue
          const c = y * nx + x
          if (dedans[c] && pan[c] >= 0) return pan[c]
        }
      }
    }
    return -1
  }
  const sortie: LigneBrute[] = []
  for (let i = 0; i < loc.length; i++) {
    if (mitoyens[i]) continue
    const a = loc[i], b = loc[(i + 1) % loc.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.3) continue
    const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    const n: Pt = [signe * u[1], -signe * u[0]]
    const k = Math.max(1, Math.round(L / PAS))
    const lus: number[] = []
    for (let j = 0; j < k; j++) {
      const t = ((j + 0.5) / k) * L
      lus.push(panEn([a[0] + u[0] * t - n[0] * 0.2, a[1] + u[1] * t - n[1] * 0.2]))
    }
    // Près d'un angle, la lecture tombe dans le pan d'à côté (un arêtier finit
    // dans le coin) : un bout de moins de 80 cm en bout de côté rejoint le
    // morceau voisin.
    const bout = Math.max(1, Math.round(0.8 / (L / k)))
    for (let passe = 0; passe < 2; passe++) {
      let j0 = 0
      while (j0 < k && lus[j0] === lus[0]) j0++
      if (j0 < k && j0 < bout) for (let j = 0; j < j0; j++) lus[j] = lus[j0]
      let j1 = k - 1
      while (j1 >= 0 && lus[j1] === lus[k - 1]) j1--
      if (j1 >= 0 && k - 1 - j1 < bout) for (let j = j1 + 1; j < k; j++) lus[j] = lus[j1]
    }
    let debut = 0
    for (let j = 1; j <= k; j++) {
      if (j < k && lus[j] === lus[debut]) continue
      const r = lus[debut]
      const long = ((j - debut) / k) * L
      if (r >= 0 && long >= 0.4) {
        const P = plans[r]
        const penteMax = Math.hypot(P.a, P.b)
        if (penteMax >= 0.05) {
          const le = P.a * u[0] + P.b * u[1]
          const dehors = P.a * n[0] + P.b * n[1]
          const type: TypeLigne = Math.abs(le) / penteMax >= DE_NIVEAU ? 'rive' : dehors < 0 ? 'egout' : 'faitage'
          const t0 = (debut / k) * L, t1 = (j / k) * L
          sortie.push({
            type,
            longueur: long * Math.sqrt(1 + le * le),
            a: [a[0] + u[0] * t0, a[1] + u[1] * t0],
            b: [a[0] + u[0] * t1, a[1] + u[1] * t1],
            regions: [r],
          })
        }
      }
      debut = j
    }
  }
  return sortie
}

/**
 * Les étiquettes de cases, sans leur bruit : chaque case prend le pan de la
 * majorité de ses huit voisines (deux passes : un bord droit y reste droit, une
 * dent d'une case disparaît), puis les îlots de moins d'un mètre carré passent
 * au pan qui les entoure. Sert au DESSIN des pans, jamais à leur surface.
 */
function lisser(pan: Int32Array, dedans: Uint8Array, nx: number, ny: number): Int32Array {
  let cur = pan.slice()
  for (let passe = 0; passe < 2; passe++) {
    const suivant = cur.slice()
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const c = cy * nx + cx
        if (!dedans[c]) continue
        const votes = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx, y = cy + dy
            if (x < 0 || y < 0 || x >= nx || y >= ny || !dedans[y * nx + x]) continue
            const v = cur[y * nx + x]
            votes.set(v, (votes.get(v) ?? 0) + 1)
          }
        }
        const propre = votes.get(cur[c]) ?? 0
        let meilleur = cur[c], n = propre
        for (const [v, k] of votes) if (k > n) [meilleur, n] = [v, k]
        if (meilleur !== cur[c] && n >= 5) suivant[c] = meilleur
      }
    }
    cur = suivant
  }
  // Les îlots : une composante de moins de 16 cases (1 m²) qui n'est pas la
  // plus grande de son pan rejoint le pan voisin le plus en contact.
  const vue = new Uint8Array(cur.length)
  const composantes: { label: number; cases: number[] }[] = []
  for (let c0 = 0; c0 < cur.length; c0++) {
    if (vue[c0] || !dedans[c0]) continue
    const label = cur[c0]
    const cases = [c0]
    vue[c0] = 1
    for (let q = 0; q < cases.length; q++) {
      const c = cases[q]
      const cx = c % nx, cy = (c - cx) / nx
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue
        const d = y * nx + x
        if (vue[d] || !dedans[d] || cur[d] !== label) continue
        vue[d] = 1
        cases.push(d)
      }
    }
    composantes.push({ label, cases })
  }
  const grande = new Map<number, number>()
  for (const k of composantes) grande.set(k.label, Math.max(grande.get(k.label) ?? 0, k.cases.length))
  for (const k of composantes) {
    if (k.cases.length >= 16 || k.cases.length === grande.get(k.label)) continue
    const contacts = new Map<number, number>()
    for (const c of k.cases) {
      const cx = c % nx, cy = (c - cx) / nx
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= nx || y >= ny || !dedans[y * nx + x]) continue
        const v = cur[y * nx + x]
        if (v !== k.label) contacts.set(v, (contacts.get(v) ?? 0) + 1)
      }
    }
    let cible = k.label, n = 0
    for (const [v, m] of contacts) if (m > n) [cible, n] = [v, m]
    for (const c of k.cases) cur[c] = cible
  }
  return cur
}

/**
 * Le contour extérieur des cases d'un pan (en coordonnées de case), simplifié.
 * On chaîne les côtés de case qui séparent le pan du reste, puis on garde la
 * plus longue boucle.
 */
function contourDeCases(pan: Int32Array, dedans: Uint8Array, nx: number, ny: number, r: number): Pt[] {
  const est = (x: number, y: number) => x >= 0 && y >= 0 && x < nx && y < ny && dedans[y * nx + x] === 1 && pan[y * nx + x] === r
  // Côtés orientés (le pan à gauche), indexés par leur origine.
  const suivants = new Map<string, Pt[]>()
  const ajouter = (a: Pt, b: Pt) => {
    const cle = `${a[0]},${a[1]}`
    suivants.set(cle, [...(suivants.get(cle) ?? []), b])
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (!est(x, y)) continue
      if (!est(x, y - 1)) ajouter([x, y], [x + 1, y])
      if (!est(x + 1, y)) ajouter([x + 1, y], [x + 1, y + 1])
      if (!est(x, y + 1)) ajouter([x + 1, y + 1], [x, y + 1])
      if (!est(x - 1, y)) ajouter([x, y + 1], [x, y])
    }
  }
  let meilleure: Pt[] = []
  while (suivants.size) {
    const [cle0, fins] = suivants.entries().next().value as [string, Pt[]]
    const depart = cle0.split(',').map(Number) as Pt
    const boucle: Pt[] = [depart]
    let cle = cle0, fin = fins
    for (let garde = 0; garde < 1e6; garde++) {
      const b = fin.pop()!
      if (!fin.length) suivants.delete(cle)
      cle = `${b[0]},${b[1]}`
      if (cle === cle0) break
      boucle.push(b)
      const f = suivants.get(cle)
      if (!f) break
      fin = f
    }
    // L'extérieur, c'est la boucle qui enferme le plus : pas celle qui a le plus de sommets (un trou peut en avoir plus).
    if (Math.abs(aireBoucle(boucle)) > Math.abs(aireBoucle(meilleure))) meilleure = boucle
  }
  return douglasPeucker(meilleure, 1.2)
}

function aireBoucle(P: Pt[]): number {
  let s = 0
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/** Simplifie une boucle fermée : tolérance en cases. */
function douglasPeucker(P: Pt[], eps: number): Pt[] {
  if (P.length < 4) return P
  // Couper la boucle à son point le plus éloigné du premier.
  let loin = 0, dMax = -1
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1])
    if (d > dMax) [loin, dMax] = [i, d]
  }
  const a = dp(P.slice(0, loin + 1), eps), b = dp([...P.slice(loin), P[0]], eps)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

function dp(P: Pt[], eps: number): Pt[] {
  if (P.length < 3) return P
  const [a, b] = [P[0], P[P.length - 1]]
  let iMax = 0, dMax = -1
  for (let i = 1; i < P.length - 1; i++) {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const L = Math.hypot(dx, dy) || 1
    const d = Math.abs((P[i][0] - a[0]) * dy - (P[i][1] - a[1]) * dx) / L
    if (d > dMax) [iMax, dMax] = [i, d]
  }
  if (dMax <= eps) return [a, b]
  return [...dp(P.slice(0, iMax + 1), eps).slice(0, -1), ...dp(P.slice(iMax), eps)]
}
