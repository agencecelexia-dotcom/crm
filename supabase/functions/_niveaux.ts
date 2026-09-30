// Les NIVEAUX du terrain autour d'une maison : le sol du jardin, la terrasse
// haute, le palier au pied d'un escalier — et ce qui les relie (escalier, talus,
// mur de soutènement). Sans Deno ni réseau.
//
// POURQUOI
//
// Le sol du relevé (`solLocal`, `_nuage.ts`) est une grille d'un mètre : il ne
// sait pas qu'une terrasse à 3 m au-dessus du jardin est un AUTRE sol. Or c'est
// lui qui fixe la hauteur d'un mur : au 27 bis rue François Rolland, la même
// façade fait 7 m au-dessus de la terrasse basse et 9,5 m au-dessus du jardin.
// Ici, on lit les niveaux dans les points de sol, et on dit lequel est au pied
// de quel mur — c'est ce que l'IA nomme ensuite (« terrasse haute », « jardin »),
// sans jamais inventer une altitude.
//
// COMMENT
//
// 1. Les points de sol (classe 2) autour de la maison, en cases de 50 cm :
//    l'altitude de la case est la médiane de ses points.
// 2. Une case est PLATE si elle ne s'écarte pas de plus de 4 cm de ses voisines
//    par case (8 %) : le jardin en pente douce l'est, une marche ou un talus non.
// 3. Les cases plates voisines à moins de 12 cm l'une de l'autre forment un
//    niveau (remplissage). Un niveau est gardé à partir de 2 m².
// 4. Deux niveaux qui se touchent par une bande de cases pentues, à plus de
//    40 cm d'écart, sont reliés par une TRANSITION : escalier (marches
//    régulières), talus ou mur (à pic).
// 5. Les dalles de terrasse que le relevé a déjà lues (`terrasse: true`, plan
//    horizontal) sont des niveaux aussi : le laser les classe « bâtiment ».

import type { Nuage } from './_copc.ts'
import { versLambert93 } from './_calcul-toit.ts'
import type { Releve } from './_releve.ts'

/** Un point (est, nord), en mètres depuis l'origine du relevé. */
export type XY = [number, number]

export interface Niveau {
  id: number
  /** Altitude, en mètres au-dessus du `zSol` du relevé. */
  z: number
  /** Surface plate (m²). */
  aire: number
  centre: XY
  /** Le rectangle qui l'enferme : [xMin, yMin, xMax, yMax]. */
  boite: [number, number, number, number]
  /** D'où il vient : le sol lu par le laser, ou la dalle d'une terrasse relevée. */
  origine: 'sol' | 'dalle'
  /** Distance au mur le plus proche (m ; 0 : il touche la maison). */
  distanceMaison: number
}

export interface Transition {
  /** Les deux niveaux reliés, du plus bas au plus haut. */
  entre: [number, number]
  /** Dénivelé (m). */
  denivele: number
  /** Longueur du bord commun (m), et pente moyenne de la bande (rapport). */
  longueur: number
  pente: number
  /**
   * Escalier (marches régulières), talus (pente douce continue) ou mur (à pic) ;
   * `a_voir` : le bord d'une dalle de terrasse, dont le laser ne dit pas s'il
   * descend par des marches ou à pic — c'est l'image qui tranche.
   */
  genre: 'escalier' | 'talus' | 'mur' | 'a_voir'
  /** Le milieu de la bande. */
  centre: XY
  /** La direction de la descente, en plan (vecteur unitaire, du haut vers le bas) : celle d'un escalier. */
  sens: XY
}

export interface Niveaux {
  niveaux: Niveau[]
  transitions: Transition[]
  /** Le niveau au pied de chacun des murs du contour (index de l'arête → id de niveau), s'il y en a un. */
  auPied: Record<number, number>
  /**
   * La grille des étiquettes (id de niveau par case de 50 cm, −1 : aucun) :
   * pour DESSINER les niveaux. Volumineuse : à ne pas garder avec le résultat.
   */
  grille?: { x0: number; y0: number; nx: number; ny: number; pas: number; label: Int32Array }
}

const PAS = 0.5
const PLAT = 0.04
const ECART_NIVEAU = 0.12
const AIRE_MIN = 2
const MARGE = 9

const r2 = (v: number) => Math.round(v * 100) / 100

/** Les niveaux du terrain autour d'un relevé, lus dans son nuage de points. */
export function niveauxDuTerrain(nu: Nuage, r: Releve): Niveaux {
  const [ox, oy] = r.origine
  const loc = ([lon, lat]: [number, number]): XY => {
    const [x, y] = versLambert93(lon, lat)
    return [x - ox, y - oy]
  }
  const murs = r.murs.map(loc)
  const xs = murs.map((p) => p[0]), ys = murs.map((p) => p[1])
  const x0 = Math.min(...xs) - MARGE, y0 = Math.min(...ys) - MARGE
  const nx = Math.ceil((Math.max(...xs) + MARGE - x0) / PAS), ny = Math.ceil((Math.max(...ys) + MARGE - y0) / PAS)
  const zSolAbs = r.zSol

  // 1. Le sol, case par case : médiane des points de sol.
  const parCase: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let i = 0; i < nu.nb; i++) {
    if (nu.classe[i] !== 2) continue
    const cx = Math.floor((nu.x[i] - ox - x0) / PAS), cy = Math.floor((nu.y[i] - oy - y0) / PAS)
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) parCase[cy * nx + cx].push(nu.z[i])
  }
  const z = new Float64Array(nx * ny).fill(NaN)
  for (let c = 0; c < z.length; c++) {
    const v = parCase[c]
    if (!v.length) continue
    v.sort((a, b) => a - b)
    z[c] = v[Math.floor(v.length / 2)]
  }
  // Ce qui est sous la maison n'est pas du terrain : le laser n'y voit que les toits.
  const dansMaison = (x: number, y: number) => dedans([x, y], murs)
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      if (dansMaison(x0 + (cx + 0.5) * PAS, y0 + (cy + 0.5) * PAS)) z[cy * nx + cx] = NaN
    }
  }
  // Les cases sans point (un point de sol tous les 25 cm en moyenne, les trous sont rares) se comblent
  // par la moyenne de leurs voisines directes, une fois.
  const comble = z.slice()
  for (let cy = 1; cy < ny - 1; cy++) {
    for (let cx = 1; cx < nx - 1; cx++) {
      const c = cy * nx + cx
      if (!Number.isNaN(z[c]) || dansMaison(x0 + (cx + 0.5) * PAS, y0 + (cy + 0.5) * PAS)) continue
      const v = [z[c - 1], z[c + 1], z[c - nx], z[c + nx]].filter((q) => !Number.isNaN(q))
      if (v.length >= 3) comble[c] = v.reduce((s, q) => s + q, 0) / v.length
    }
  }
  z.set(comble)

  // 2. Plate ou pentue : l'écart maximal à une voisine directe.
  const pente = new Float64Array(nx * ny).fill(NaN)
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      const c = cy * nx + cx
      if (Number.isNaN(z[c])) continue
      let m = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = cx + dx, Y = cy + dy
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue
        const q = z[Y * nx + X]
        if (!Number.isNaN(q)) m = Math.max(m, Math.abs(q - z[c]))
      }
      pente[c] = m
    }
  }

  // 3. Les niveaux : remplissage des cases plates.
  const label = new Int32Array(nx * ny).fill(-1)
  const niveaux: (Niveau & { cases: number[] })[] = []
  for (let c0 = 0; c0 < z.length; c0++) {
    if (label[c0] >= 0 || Number.isNaN(z[c0]) || pente[c0] > PLAT) continue
    const cases = [c0]
    label[c0] = niveaux.length
    for (let q = 0; q < cases.length; q++) {
      const c = cases[q]
      const cx = c % nx, cy = (c - cx) / nx
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = cx + dx, Y = cy + dy
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue
        const d = Y * nx + X
        if (label[d] >= 0 || Number.isNaN(z[d]) || pente[d] > PLAT || Math.abs(z[d] - z[c]) > ECART_NIVEAU) continue
        label[d] = niveaux.length
        cases.push(d)
      }
    }
    const aire = cases.length * PAS * PAS
    if (aire < AIRE_MIN) {
      for (const c of cases) label[c] = -2
      continue
    }
    const zs = cases.map((c) => z[c]).sort((a, b) => a - b)
    const gx = cases.map((c) => x0 + ((c % nx) + 0.5) * PAS), gy = cases.map((c) => y0 + (Math.floor(c / nx) + 0.5) * PAS)
    niveaux.push({
      id: niveaux.length,
      z: r2(zs[Math.floor(zs.length / 2)] - zSolAbs),
      aire: r2(aire),
      centre: [r2(gx.reduce((s, v) => s + v, 0) / gx.length), r2(gy.reduce((s, v) => s + v, 0) / gy.length)],
      boite: [r2(Math.min(...gx)), r2(Math.min(...gy)), r2(Math.max(...gx)), r2(Math.max(...gy))],
      origine: 'sol',
      distanceMaison: 0,
      cases,
    })
  }

  // Les dalles de terrasse déjà lues par le relevé : le laser les classe « bâtiment ».
  for (const p of r.pans) {
    if (!p.terrasse) continue
    const P = p.contour.map(loc)
    const cx = P.reduce((s, q) => s + q[0], 0) / P.length, cy = P.reduce((s, q) => s + q[1], 0) / P.length
    const [a, b, c] = p.plan
    niveaux.push({
      id: niveaux.length,
      z: r2(a * cx + b * cy + c),
      aire: r2(p.airePlan),
      centre: [r2(cx), r2(cy)],
      boite: [r2(Math.min(...P.map((q) => q[0]))), r2(Math.min(...P.map((q) => q[1]))), r2(Math.max(...P.map((q) => q[0]))), r2(Math.max(...P.map((q) => q[1])))],
      origine: 'dalle',
      distanceMaison: 0,
      cases: [],
    })
  }

  // Distance de chaque niveau à la maison.
  for (const n of niveaux) {
    if (n.origine === 'dalle') continue
    let d = Infinity
    for (const c of n.cases.filter((_, i) => i % 3 === 0)) {
      const p: XY = [x0 + ((c % nx) + 0.5) * PAS, y0 + (Math.floor(c / nx) + 0.5) * PAS]
      d = Math.min(d, distanceAuContour(p, murs))
    }
    n.distanceMaison = r2(d)
  }

  // 4. Les transitions : des cases pentues qui touchent deux niveaux.
  const contacts = new Map<string, { cases: Set<number>; longueur: number; pentes: number[] }>()
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      const c = cy * nx + cx
      if (label[c] < 0 || label[c] === -2) continue
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const X = cx + dx, Y = cy + dy
        if (X >= nx || Y >= ny) continue
        // Une ou deux cases pentues entre les deux niveaux.
        for (let k = 1; k <= 3; k++) {
          const X2 = cx + dx * (k + 1), Y2 = cy + dy * (k + 1)
          if (X2 >= nx || Y2 >= ny) break
          const entre = Array.from({ length: k }, (_, j) => (cy + dy * (j + 1)) * nx + cx + dx * (j + 1))
          const d = Y2 * nx + X2
          if (label[d] < 0 || label[d] === label[c]) continue
          if (entre.some((e) => label[e] >= 0 || Number.isNaN(z[e]))) continue
          const [i, j] = label[c] < label[d] ? [label[c], label[d]] : [label[d], label[c]]
          const cle = `${i}-${j}`
          const o = contacts.get(cle) ?? { cases: new Set<number>(), longueur: 0, pentes: [] }
          entre.forEach((e) => o.cases.add(e))
          o.longueur += PAS
          o.pentes.push(Math.abs(z[d] - z[c]) / ((k + 1) * PAS))
          contacts.set(cle, o)
        }
      }
    }
  }
  const transitions: Transition[] = []
  for (const [cle, o] of contacts) {
    const [i, j] = cle.split('-').map(Number)
    const A = niveaux[i], B = niveaux[j]
    const dz = Math.abs(A.z - B.z)
    if (dz < 0.4 || o.longueur < 1) continue
    const [bas, haut] = A.z <= B.z ? [A, B] : [B, A]
    const cs = [...o.cases]
    const gx = cs.map((c) => x0 + ((c % nx) + 0.5) * PAS), gy = cs.map((c) => y0 + (Math.floor(c / nx) + 0.5) * PAS)
    const p = o.pentes.sort((a, b) => a - b)[Math.floor(o.pentes.length / 2)]
    transitions.push({
      entre: [bas.id, haut.id],
      denivele: r2(dz),
      longueur: r2(o.longueur),
      pente: r2(p),
      genre: p > 1.6 ? 'mur' : p > 0.45 ? 'escalier' : 'talus',
      centre: [r2(gx.reduce((s, v) => s + v, 0) / gx.length), r2(gy.reduce((s, v) => s + v, 0) / gy.length)],
      sens: unitaire([bas.centre[0] - haut.centre[0], bas.centre[1] - haut.centre[1]]),
    })
  }

  // Le bord d'une dalle de terrasse : le sol qu'on voit un à deux mètres au-delà.
  for (const d of niveaux.filter((n) => n.origine === 'dalle')) {
    const p = r.pans.find((q) => q.terrasse && Math.abs(q.airePlan - d.aire) < 0.05)
    if (!p) continue
    const P = p.contour.map(loc)
    const sensP = aireSignee(P) > 0 ? 1 : -1
    const vus = new Map<number, { longueur: number; x: number; y: number; nx: number; ny: number }>()
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.5) continue
      const n: XY = [(sensP * (b[1] - a[1])) / L, (-sensP * (b[0] - a[0])) / L]
      for (let s = 0.25; s < L; s += 0.5) {
        const px = a[0] + ((b[0] - a[0]) * s) / L, py = a[1] + ((b[1] - a[1]) * s) / L
        for (const dehors of [1, 1.5, 2]) {
          const cx = Math.floor((px + n[0] * dehors - x0) / PAS), cy = Math.floor((py + n[1] * dehors - y0) / PAS)
          if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
          const l = label[cy * nx + cx]
          if (l < 0) continue
          const o = vus.get(l) ?? { longueur: 0, x: 0, y: 0, nx: 0, ny: 0 }
          o.longueur += 0.5 / 3
          o.x += px
          o.y += py
          o.nx += n[0]
          o.ny += n[1]
          vus.set(l, o)
          break
        }
      }
    }
    for (const [l, o] of vus) {
      const sol = niveaux[l]
      const dz = Math.abs(d.z - sol.z)
      if (dz < 0.4 || o.longueur < 1) continue
      const k = o.longueur / (0.5 / 3)
      const [bas, haut] = sol.z <= d.z ? [sol, d] : [d, sol]
      transitions.push({
        entre: [bas.id, haut.id],
        denivele: r2(dz),
        longueur: r2(o.longueur),
        pente: 0,
        genre: 'a_voir',
        centre: [r2(o.x / k), r2(o.y / k)],
        // Du bord de la dalle vers l'extérieur : c'est là que l'escalier descend.
        sens: unitaire([o.nx, o.ny]),
      })
    }
  }

  // Le niveau au pied de chaque mur : celui du sol à un mètre dehors.
  const auPied: Record<number, number> = {}
  const sens = aireSignee(murs) > 0 ? 1 : -1
  for (let i = 0; i < murs.length; i++) {
    const a = murs[i], b = murs[(i + 1) % murs.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.5) continue
    const n: XY = [(sens * (b[1] - a[1])) / L, (-sens * (b[0] - a[0])) / L]
    const votes = new Map<number, number>()
    for (let s = 0.25; s < L; s += 0.5) {
      for (const dehors of [1, 1.5]) {
        const x = a[0] + ((b[0] - a[0]) * s) / L + n[0] * dehors, y = a[1] + ((b[1] - a[1]) * s) / L + n[1] * dehors
        const cx = Math.floor((x - x0) / PAS), cy = Math.floor((y - y0) / PAS)
        if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
        const l = label[cy * nx + cx]
        if (l >= 0) votes.set(l, (votes.get(l) ?? 0) + 1)
      }
    }
    let meilleur = -1, n0 = 0
    for (const [l, k] of votes) if (k > n0) [meilleur, n0] = [l, k]
    if (meilleur >= 0) auPied[i] = meilleur
  }

  return { niveaux: niveaux.map((n) => ({ id: n.id, z: n.z, aire: n.aire, centre: n.centre, boite: n.boite, origine: n.origine, distanceMaison: n.distanceMaison })), transitions, auPied, grille: { x0, y0, nx, ny, pas: PAS, label } }
}

function unitaire([x, y]: XY): XY {
  const L = Math.hypot(x, y) || 1
  return [r2(x / L), r2(y / L)]
}

function aireSignee(P: XY[]): number {
  let s = 0
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

function dedans(p: XY, P: XY[]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}

function distanceAuContour(p: XY, P: XY[]): number {
  if (dedans(p, P)) return 0
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
