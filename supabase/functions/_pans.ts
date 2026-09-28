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
}

export interface LecturePans {
  pans: PanToit[]
  /** Points de toit qui ne tiennent à aucun pan : cheminées, antennes, bords. */
  pointsDivers: number
  /** Surface du contour du toit sans aucun point de toit (m²). */
  aireSansPoints: number
  /** Surfaces totales (m²). */
  airePlan: number
  aireVraie: number
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
export function lirePans(nu: Nuage, h: Float32Array, toit: Pt[]): LecturePans {
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
  const etiquette = new Int32Array(m).fill(-1)
  const graines = [...tous].filter((k) => E[k] < ECART_GRAINE).sort((p, q) => E[p] - E[q])
  let regions: { ids: number[]; plan: Plan }[] = []
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
  const decoupe = decouper(toit, x0, y0, regions.map((r) => r.plan), etiquette, X, Y, nu, h)
  const aireTotale = aireL93(toit)
  const pans: PanToit[] = []
  regions.forEach((r, i) => {
    const cases = decoupe.parPan[i]
    const airePlan = decoupe.total ? (aireTotale * cases) / decoupe.total : 0
    if (airePlan < AIRE_PAN_MIN || r.ids.length < POINTS_MIN) return
    const { a, b, c, ecart } = r.plan
    const pente = Math.hypot(a, b)
    pans.push({
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
    })
  })
  pans.sort((p, q) => q.aireVraie - p.aireVraie)
  pans.forEach((p, i) => (p.id = i + 1))
  // Les cases des pans écartés (trop petits) restent comptées : on répartit
  // leur surface au prorata, pour que la somme des pans égale le contour.
  const sommePlan = pans.reduce((s, p) => s + p.airePlan, 0)
  const k = sommePlan ? aireTotale / sommePlan : 1
  for (const p of pans) {
    p.airePlan = Math.round(p.airePlan * k * 10) / 10
    p.aireVraie = Math.round(p.aireVraie * k * 10) / 10
    p.partReconstituee = Math.round(p.partReconstituee * 100) / 100
  }
  let libres = 0
  for (let q = 0; q < m; q++) if (etiquette[q] < 0) libres++
  return {
    pans,
    pointsDivers: libres,
    aireSansPoints: Math.round(decoupe.sansPoints * PAS * PAS * 10) / 10,
    airePlan: Math.round(aireTotale * 10) / 10,
    aireVraie: Math.round(pans.reduce((s, p) => s + p.aireVraie, 0) * 10) / 10,
  }
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
  nu: Nuage,
  h: Float32Array,
): { total: number; parPan: number[]; reconstituees: number[]; sansPoints: number; contours: Pt[][] } {
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
        pan[d] = pan[c]
        suivant.push(d)
      }
    }
    front = suivant
  }
  redresser(pan, dedans, nx, ny, plans, (cx, cy) => [minX + (cx + 0.5) * PAS, minY + (cy + 0.5) * PAS])

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
  let total = 0, sansPoints = 0
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
  }
  const contours: Pt[][] = []
  for (let r = 0; r < nbPans; r++) {
    contours.push(
      contourDeCases(pan, dedans, nx, ny, r).map(([cx, cy]) => [minX + cx * PAS, minY + cy * PAS] as Pt),
    )
  }
  return { total, parPan, reconstituees, sansPoints, contours }
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
) {
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
        limites.set(cle, [...(limites.get(cle) ?? []), Math.abs(z(i, p) - z(j, p))])
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
  if (!sens.size) return
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
            if ((sn > 0 && d < -0.005) || (sn < 0 && d > 0.005)) A = B
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
    if (boucle.length > meilleure.length) meilleure = boucle
  }
  return douglasPeucker(meilleure, 1.2)
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
