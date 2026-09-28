// Recaler le contour du cadastre sur le toit relevé par le LiDAR, puis
// mesurer le débord du toit, côté par côté. Sans Deno ni réseau.
//
// POURQUOI RECALER
//
// Les contours de la BD TOPO viennent du plan cadastral, placé à ±3 à 5 m
// selon l'IGN lui-même (`precision_planimetrique`). Le nuage de points LiDAR,
// lui, est placé à une dizaine de centimètres. Un contour posé à côté du toit
// fausse ce qu'on y lit (hauteurs, pentes), et l'écart se voit sur la carte.
// Sa FORME, en revanche, est juste à quelques décimètres : on le déplace sans
// le déformer.
//
// COMMENT
//
// Le bord d'un toit est là où les points de bâtiment s'arrêtent et où le sol
// commence. On cherche le déplacement, et un débord moyen, qui posent le
// contour sur ces bords — et avec lui ceux des voisins, tirés du même plan et
// décalés de la même erreur. Là où rien ne borde le toit (mur mitoyen, arbre
// qui le couvre), le contour n'est ni attiré ni repoussé.
//
// LE DÉBORD
//
// Le LiDAR voit le toit, pas le pied des murs. Une fois le contour recalé, le
// débord d'un côté est l'écart entre son mur et le bord du toit relevé : de
// 5 cm dans le Finistère à 1 m en Savoie, là où l'on comptait 40 cm partout.

import type { Nuage, Zone } from './_copc.ts'
import { Grille2D } from './_nuage.ts'

/** Un point en Lambert-93, en mètres. */
export type Pt = [number, number]

// ---------- Hauteurs et masques ----------

/** La hauteur de chaque point au-dessus du sol local. */
export function hauteurs(nu: Nuage, sol: (x: number, y: number) => number): Float32Array {
  const h = new Float32Array(nu.nb)
  for (let i = 0; i < nu.nb; i++) h[i] = nu.z[i] - sol(nu.x[i], nu.y[i])
  return h
}

/** Sous cette hauteur, un point « bâtiment » est un muret, une marche, une erreur de classe. */
export const HAUTEUR_TOIT_MIN = 1.5

/** Un point de bâtiment qui compte comme toit. */
export const estToit = (nu: Nuage, h: Float32Array, i: number) => nu.classe[i] === 6 && h[i] >= HAUTEUR_TOIT_MIN
/** Un point où l'on voit le sol : sol classé, ou herbe rase. */
export const estSol = (nu: Nuage, h: Float32Array, i: number) => nu.classe[i] === 2 || (nu.classe[i] === 3 && h[i] < 0.5)
/** Un point de végétation assez haut pour cacher un bord de toit. */
export const estFeuillage = (nu: Nuage, h: Float32Array, i: number) => nu.classe[i] >= 3 && nu.classe[i] <= 5 && h[i] >= 1

export interface Masques {
  pas: number
  nx: number
  ny: number
  x0: number
  y0: number
  /** Case couverte par le toit (trous d'un point bouchés). */
  toit: Uint8Array
  /** Case où l'on voit le sol. */
  sol: Uint8Array
  /** Case de toit qui touche du sol : un bord visible. */
  bord: Uint8Array
}

/**
 * Les masques d'une zone, en cases de `pas` mètres. À 39 points par m², une
 * case de 25 cm reçoit un ou deux points : une sur trois reste vide au milieu
 * d'un toit. Une fermeture (dilatation puis érosion d'une case) bouche ces
 * trous sans déplacer le bord.
 */
export function masques(nu: Nuage, h: Float32Array, zone: Zone, pas = 0.25): Masques {
  const nx = Math.ceil((zone.maxX - zone.minX) / pas)
  const ny = Math.ceil((zone.maxY - zone.minY) / pas)
  const brut = new Uint8Array(nx * ny)
  const sol = new Uint8Array(nx * ny)
  for (let i = 0; i < nu.nb; i++) {
    const cx = Math.floor((nu.x[i] - zone.minX) / pas), cy = Math.floor((nu.y[i] - zone.minY) / pas)
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
    if (estToit(nu, h, i)) brut[cy * nx + cx] = 1
    else if (estSol(nu, h, i)) sol[cy * nx + cx] = 1
  }
  const toit = eroder(dilater(brut, nx, ny), nx, ny)
  // Une case de sol sous une case de toit (point de sol vu sous le débord) ne
  // compte pas comme sol.
  for (let k = 0; k < sol.length; k++) if (toit[k]) sol[k] = 0

  // Le bord visible : une case de toit voisine d'une case vide ou de sol, avec
  // du sol à moins de deux cases. Sans sol à côté (arbre, mur mitoyen, trou
  // de données), le bord n'est pas sûr : il ne compte pas.
  const bord = new Uint8Array(nx * ny)
  for (let cy = 1; cy < ny - 1; cy++) {
    for (let cx = 1; cx < nx - 1; cx++) {
      const k = cy * nx + cx
      if (!toit[k]) continue
      if (toit[k - 1] && toit[k + 1] && toit[k - nx] && toit[k + nx]) continue
      let solProche = false
      for (let dy = -2; dy <= 2 && !solProche; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = cx + dx, y = cy + dy
          if (x >= 0 && y >= 0 && x < nx && y < ny && sol[y * nx + x]) {
            solProche = true
            break
          }
        }
      }
      if (solProche) bord[k] = 1
    }
  }
  return { pas, nx, ny, x0: zone.minX, y0: zone.minY, toit, sol, bord }
}

function dilater(m: Uint8Array, nx: number, ny: number): Uint8Array {
  const s = new Uint8Array(m.length)
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      if (!m[cy * nx + cx]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy
          if (x >= 0 && y >= 0 && x < nx && y < ny) s[y * nx + x] = 1
        }
      }
    }
  }
  return s
}

function eroder(m: Uint8Array, nx: number, ny: number): Uint8Array {
  const s = new Uint8Array(m.length)
  for (let cy = 1; cy < ny - 1; cy++) {
    for (let cx = 1; cx < nx - 1; cx++) {
      let plein = 1
      for (let dy = -1; dy <= 1 && plein; dy++) for (let dx = -1; dx <= 1; dx++) if (!m[(cy + dy) * nx + cx + dx]) { plein = 0; break }
      s[cy * nx + cx] = plein
    }
  }
  return s
}

/**
 * La distance de chaque case au bord visible le plus proche, en mètres
 * (transformée exacte de Felzenszwalb et Huttenlocher, ligne puis colonne).
 */
export function distanceAuBord(m: Masques): Float32Array {
  const { nx, ny } = m
  const INF = 1e10
  const g = new Float64Array(nx * ny)
  for (let k = 0; k < g.length; k++) g[k] = m.bord[k] ? 0 : INF
  const n = Math.max(nx, ny)
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1)
  const v = new Int32Array(n)
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) f[cx] = g[cy * nx + cx]
    edt1d(f, nx, d, v, z)
    for (let cx = 0; cx < nx; cx++) g[cy * nx + cx] = d[cx]
  }
  for (let cx = 0; cx < nx; cx++) {
    for (let cy = 0; cy < ny; cy++) f[cy] = g[cy * nx + cx]
    edt1d(f, ny, d, v, z)
    for (let cy = 0; cy < ny; cy++) g[cy * nx + cx] = d[cy]
  }
  const sortie = new Float32Array(nx * ny)
  for (let k = 0; k < g.length; k++) sortie[k] = Math.sqrt(g[k]) * m.pas
  return sortie
}

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) ** 2 + f[v[k]]
  }
}

// ---------- Polygones ----------

export function aireSignee(P: Pt[]): number {
  let s = 0
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += P[j][0] * P[i][1] - P[i][0] * P[j][1]
  return s / 2
}

export const aireL93 = (P: Pt[]) => Math.abs(aireSignee(P))

export function dansPolygone(x: number, y: number, P: Pt[]): boolean {
  let dedans = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans
  }
  return dedans
}

export const deplacer = (P: Pt[], dx: number, dy: number): Pt[] => P.map(([x, y]) => [x + dx, y + dy])

/** La normale extérieure de l'arête i (du sommet i au suivant), unitaire. */
export function normaleExterieure(P: Pt[], i: number): Pt {
  const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length]
  const L = Math.hypot(bx - ax, by - ay) || 1
  // Sens trigonométrique : l'intérieur est à gauche, l'extérieur à droite.
  const s = aireSignee(P) > 0 ? 1 : -1
  return [(s * (by - ay)) / L, (-s * (bx - ax)) / L]
}

/**
 * Le polygone dont chaque arête est repoussée vers l'extérieur de son propre
 * décalage : le contour du toit, débord compris, à partir des murs.
 */
export function decaler(P: Pt[], decalages: number[]): Pt[] {
  const n = P.length
  const lignes = P.map((a, i) => {
    const b = P[(i + 1) % n]
    const [nx, ny] = normaleExterieure(P, i)
    const d = decalages[i] ?? 0
    return { a: [a[0] + nx * d, a[1] + ny * d] as Pt, b: [b[0] + nx * d, b[1] + ny * d] as Pt, n: [nx, ny] as Pt, d }
  })
  return P.map((p, i) => {
    const l1 = lignes[(i - 1 + n) % n], l2 = lignes[i]
    const r = intersection(l1.a, l1.b, l2.a, l2.b)
    // Deux arêtes alignées : le sommet suit la normale commune.
    if (!r || Math.hypot(r[0] - p[0], r[1] - p[1]) > 5 + Math.abs(l1.d) + Math.abs(l2.d)) {
      return [p[0] + ((l1.n[0] * l1.d + l2.n[0] * l2.d) / 2), p[1] + ((l1.n[1] * l1.d + l2.n[1] * l2.d) / 2)]
    }
    return r
  })
}

function intersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9 * Math.hypot(...r) * Math.hypot(...s)) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  return [a[0] + t * r[0], a[1] + t * r[1]]
}

/** Distance d'un point au segment [a, b]. */
export function distanceSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Plus près que ça d'un autre bâtiment, un mur est mitoyen (même règle que `longueurAccolee`). */
const CONTACT_M = 0.6

/** La part de l'arête i le long de laquelle un autre bâtiment la touche. */
export function partAccolee(P: Pt[], i: number, autres: Pt[][]): number {
  const a = P[i], b = P[(i + 1) % P.length]
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (L < 0.3 || !autres.length) return 0
  const k = Math.max(2, Math.round(L / 0.25))
  let touche = 0
  for (let j = 0; j < k; j++) {
    const t = (j + 0.5) / k
    const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (autres.some((Q) => Q.some((q, m) => distanceSegment(p, q, Q[(m + 1) % Q.length]) <= CONTACT_M))) touche++
  }
  return touche / k
}

// ---------- Recalage ----------

interface Echantillon {
  x: number
  y: number
  nx: number
  ny: number
  poids: number
  maison: boolean
}

/**
 * Les points du bord des contours, tous les 25 cm, avec leur normale. On saute
 * les coins (le toit s'y arrondit) et les murs mitoyens (aucun bord de toit à
 * y trouver).
 */
function echantillons(polys: { P: Pt[]; maison: boolean }[], pas = 0.25): Echantillon[] {
  const sortie: Echantillon[] = []
  for (let k = 0; k < polys.length; k++) {
    const { P, maison } = polys[k]
    const autres = polys.filter((_, j) => j !== k).map((q) => q.P)
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const [nx, ny] = normaleExterieure(P, i)
      for (let s = 0.4; s <= L - 0.4; s += pas) {
        const p: Pt = [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]
        if (autres.some((Q) => Q.some((q, m) => distanceSegment(p, q, Q[(m + 1) % Q.length]) <= CONTACT_M))) continue
        sortie.push({ x: p[0], y: p[1], nx, ny, poids: maison ? 1 : 0.5, maison })
      }
    }
  }
  return sortie
}

export interface Recalage {
  /** Le déplacement à appliquer au cadastre, en mètres (est, nord). */
  dx: number
  dy: number
  /** Le débord moyen qui a servi à caler (le débord mesuré est par côté). */
  debordMoyen: number
  /** Écart médian entre les murs décalés du débord et les bords de toit trouvés. */
  ecart: number
  /** Part du tour de la maison (hors mitoyens) posée sur un bord de toit. */
  appui: number
  /** Part de l'emprise recalée couverte de toit. */
  couverture: number
  /** Le recalage est-il retenu ? Sinon, dx = dy = 0 et `motif` dit pourquoi. */
  fiable: boolean
  motif: 'trop_peu_de_bords' | 'recalage_ambigu' | 'maison_absente' | null
}

/** Au-delà, un échantillon ne trouve pas son bord : il ne tire plus. */
const TRONCATURE = 0.75
/** Recherche du déplacement : ±6 m autour du cadastre. */
const PORTEE = 6

/**
 * Le déplacement qui pose le contour de la maison (et ceux des voisins) sur
 * les bords du toit relevé. Recherche exhaustive au pas de la grille, puis
 * affinée au pas de 5 cm.
 */
export function recaler(m: Masques, distance: Float32Array, maison: Pt[], voisins: Pt[][]): Recalage {
  const polys = [{ P: maison, maison: true }, ...voisins.map((P) => ({ P, maison: false }))]
  const ech = echantillons(polys)
  const nMaison = ech.filter((e) => e.maison).length

  // Les cases à l'intérieur de la maison, pour mesurer la couverture.
  const interieur: number[] = []
  const [minX, minY, maxX, maxY] = boite(maison)
  for (let y = minY + m.pas / 2; y < maxY; y += m.pas) {
    for (let x = minX + m.pas / 2; x < maxX; x += m.pas) {
      if (dansPolygone(x, y, maison)) interieur.push(x, y)
    }
  }
  const couverture = (dx: number, dy: number) => {
    let toit = 0, n = 0
    for (let k = 0; k < interieur.length; k += 2) {
      const cx = Math.floor((interieur[k] + dx - m.x0) / m.pas), cy = Math.floor((interieur[k + 1] + dy - m.y0) / m.pas)
      if (cx < 0 || cy < 0 || cx >= m.nx || cy >= m.ny) continue
      n++
      if (m.toit[cy * m.nx + cx]) toit++
    }
    return n ? toit / n : 0
  }

  const lire = (x: number, y: number) => {
    const fx = (x - m.x0) / m.pas - 0.5, fy = (y - m.y0) / m.pas - 0.5
    const cx = Math.floor(fx), cy = Math.floor(fy)
    if (cx < 0 || cy < 0 || cx >= m.nx - 1 || cy >= m.ny - 1) return NaN
    const tx = fx - cx, ty = fy - cy, k = cy * m.nx + cx
    return (
      distance[k] * (1 - tx) * (1 - ty) + distance[k + 1] * tx * (1 - ty) +
      distance[k + m.nx] * (1 - tx) * ty + distance[k + m.nx + 1] * tx * ty
    )
  }
  // Le coût : distance tronquée au carré, moyenne pondérée ; plus une pénalité
  // si l'emprise tombe hors du toit (un contour sur la pelouse n'est pas calé,
  // même s'il longe le bord d'un autre toit).
  const chanfrein = (dx: number, dy: number, d: number) => {
    let s = 0, w = 0
    for (const e of ech) {
      const v = lire(e.x + dx + e.nx * d, e.y + dy + e.ny * d)
      if (Number.isNaN(v)) continue
      const t = Math.min(v, TRONCATURE)
      s += e.poids * t * t
      w += e.poids
    }
    return w ? s / w : TRONCATURE ** 2
  }
  const penalite = (cov: number) => TRONCATURE ** 2 * (1 - cov)

  // 1. Recherche large, au pas de la grille.
  const debords = [0, 0.25, 0.5, 0.75, 1, 1.25]
  const grille: { dx: number; dy: number; d: number; c: number }[] = []
  for (let dx = -PORTEE; dx <= PORTEE + 1e-9; dx += m.pas) {
    for (let dy = -PORTEE; dy <= PORTEE + 1e-9; dy += m.pas) {
      const p = penalite(couverture(dx, dy))
      let meilleur = { d: 0, c: Infinity }
      for (const d of debords) {
        const c = chanfrein(dx, dy, d) + p
        if (c < meilleur.c) meilleur = { d, c }
      }
      grille.push({ dx, dy, ...meilleur })
    }
  }
  grille.sort((a, b) => a.c - b.c)
  const premier = grille[0]

  // 2. Affiner au pas de 5 cm autour du meilleur.
  let fin = premier
  for (let dx = premier.dx - 0.3; dx <= premier.dx + 0.3 + 1e-9; dx += 0.05) {
    for (let dy = premier.dy - 0.3; dy <= premier.dy + 0.3 + 1e-9; dy += 0.05) {
      const p = penalite(couverture(dx, dy))
      for (let d = Math.max(-0.2, premier.d - 0.3); d <= premier.d + 0.3 + 1e-9; d += 0.05) {
        const c = chanfrein(dx, dy, d) + p
        if (c < fin.c) fin = { dx, dy, d, c }
      }
    }
  }

  // 3. Qualité : les échantillons de la maison posés sur un bord.
  const ecarts: number[] = []
  let appuyes = 0
  for (const e of ech) {
    if (!e.maison) continue
    const v = lire(e.x + fin.dx + e.nx * fin.d, e.y + fin.dy + e.ny * fin.d)
    if (Number.isNaN(v)) continue
    if (v <= 0.35) {
      appuyes++
      ecarts.push(v)
    }
  }
  ecarts.sort((a, b) => a - b)
  const appui = nMaison ? appuyes / nMaison : 0
  const cov = couverture(fin.dx, fin.dy)
  // Un second minimum, loin du premier et presque aussi bon : on ne sait pas.
  const second = grille.find((g) => Math.hypot(g.dx - premier.dx, g.dy - premier.dy) > 1.5)
  const ambigu = !!second && second.c < premier.c * 1.1 + 0.005

  const base = {
    debordMoyen: arrondi(fin.d),
    ecart: arrondi(ecarts.length ? ecarts[Math.floor(ecarts.length / 2)] : TRONCATURE),
    appui: arrondi(appui),
    couverture: arrondi(cov),
  }
  const motif = cov < 0.5 ? 'maison_absente' : appui < 0.35 ? 'trop_peu_de_bords' : ambigu ? 'recalage_ambigu' : null
  if (motif) return { dx: 0, dy: 0, ...base, couverture: arrondi(couverture(0, 0)), fiable: false, motif }
  return { dx: arrondi(fin.dx), dy: arrondi(fin.dy), ...base, fiable: true, motif: null }
}

const arrondi = (v: number) => Math.round(v * 100) / 100

function boite(P: Pt[]): [number, number, number, number] {
  return [
    Math.min(...P.map((p) => p[0])),
    Math.min(...P.map((p) => p[1])),
    Math.max(...P.map((p) => p[0])),
    Math.max(...P.map((p) => p[1])),
  ]
}

// ---------- Débord, côté par côté ----------

/**
 * Ce qu'on sait du bord du toit au droit d'un mur :
 * - `mesure` : le toit s'arrête, le sol commence — le débord est lu ;
 * - `marche` : le toit descend d'un coup sur un toit plus bas (annexe, garage) ;
 * - `accole` : un autre bâtiment touche le mur, le toit continue chez lui ;
 * - `cache` : un arbre couvre le bord ;
 * - `inconnu` : trop peu de points pour conclure.
 */
export type EtatBord = 'mesure' | 'marche' | 'accole' | 'cache' | 'inconnu'

export interface Bord {
  /** L'arête du contour (du sommet i au suivant). */
  arete: number
  longueur: number
  etat: EtatBord
  /** Distance du mur au bord du toit, vers l'extérieur, en mètres. */
  debord: number | null
  /** Demi-écart interquartile des lectures le long du mur. */
  dispersion: number | null
  /** Lectures valides le long du mur. */
  lectures: number
}

/** Un bord n'est lu qu'au-delà de cette part du mur. */
const PART_LUE_MIN = 0.3

/** Une lecture du bord, pour la dessiner (diagnostic). */
export interface LectureBord {
  x: number
  y: number
  etat: 'mesure' | 'marche' | 'cache' | 'inconnu'
}

/**
 * Le débord de chaque côté du contour (recalé). Le long du mur, tous les
 * 25 cm, une bande de 60 cm de large : on part de l'intérieur du toit et l'on
 * suit sa surface vers l'extérieur jusqu'au premier vide.
 */
export function mesurerBords(
  nu: Nuage,
  h: Float32Array,
  grille: Grille2D,
  P: Pt[],
  voisins: Pt[][],
  trace?: LectureBord[],
): Bord[] {
  const bords: Bord[] = []
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const base = { arete: i, longueur: arrondi(L) }
    if (partAccolee(P, i, voisins) >= 0.5) {
      bords.push({ ...base, etat: 'accole', debord: 0, dispersion: null, lectures: 0 })
      continue
    }
    if (L < 1) {
      bords.push({ ...base, etat: 'inconnu', debord: null, dispersion: null, lectures: 0 })
      continue
    }
    const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    const n = normaleExterieure(P, i)
    const lus: number[] = []
    let marches = 0, caches = 0, total = 0
    for (let s = 0.4; s <= L - 0.4; s += 0.25) {
      total++
      const q: Pt = [a[0] + u[0] * s, a[1] + u[1] * s]
      const r = lireBord(nu, h, grille, q, u, n)
      if (r.bord !== undefined) lus.push(r.bord)
      if (r.etat === 'marche') marches++
      if (r.etat === 'cache') caches++
      trace?.push({ x: q[0] + n[0] * (r.bord ?? 0), y: q[1] + n[1] * (r.bord ?? 0), etat: r.etat })
    }
    if (!total || lus.length < Math.max(3, total * PART_LUE_MIN)) {
      bords.push({ ...base, etat: caches > total * 0.3 ? 'cache' : 'inconnu', debord: null, dispersion: null, lectures: lus.length })
      continue
    }
    lus.sort((x, y) => x - y)
    const q1 = lus[Math.floor(lus.length * 0.25)], q3 = lus[Math.floor(lus.length * 0.75)]
    bords.push({
      ...base,
      etat: marches > lus.length / 2 ? 'marche' : 'mesure',
      debord: arrondi(lus[Math.floor(lus.length / 2)]),
      dispersion: arrondi((q3 - q1) / 2),
      lectures: lus.length,
    })
  }
  return bords
}

/**
 * Le bord du toit dans une bande perpendiculaire au mur, au point q.
 *
 * On suit l'ENVELOPPE HAUTE, par tranches de 20 cm : sous une gouttière, le
 * LiDAR touche aussi le mur, et ces points plus bas ne sont pas un toit qui
 * descend. Le bord est juste après le dernier point de toit — à l'écart
 * attendu entre deux points à cette densité —, sans dépasser le premier point
 * de sol : le sol au pied d'un mur est souvent dans l'ombre du toit.
 */
function lireBord(
  nu: Nuage,
  h: Float32Array,
  grille: Grille2D,
  q: Pt,
  u: Pt,
  n: Pt,
): { etat: 'mesure' | 'marche' | 'cache' | 'inconnu'; bord?: number } {
  const DEDANS = -1.5, DEHORS = 2.5, DEMI_LARGEUR = 0.3, TRANCHE = 0.2
  const nb = Math.ceil((DEHORS + 1 - DEDANS) / TRANCHE)
  const haut = new Float64Array(nb).fill(-Infinity)
  const loin = new Float64Array(nb).fill(-Infinity)
  const sol: number[] = []
  const feuillage: number[] = []
  let nToit = 0
  for (const i of grille.autour(q[0], q[1], 3.6)) {
    const px = nu.x[i] - q[0], py = nu.y[i] - q[1]
    if (Math.abs(px * u[0] + py * u[1]) > DEMI_LARGEUR) continue
    const s = px * n[0] + py * n[1]
    if (s < DEDANS || s >= DEHORS + 1) continue
    if (estToit(nu, h, i)) {
      const k = Math.floor((s - DEDANS) / TRANCHE)
      if (h[i] > haut[k]) haut[k] = h[i]
      if (s > loin[k]) loin[k] = s
      if (s <= 0) nToit++
    } else if (estSol(nu, h, i)) sol.push(s)
    else if (estFeuillage(nu, h, i)) feuillage.push(s)
  }
  // Le toit doit couvrir le mur : sinon ce contour n'est pas sous ce toit.
  const kMur = Math.floor(-DEDANS / TRANCHE)
  let pleines = 0
  for (let k = 0; k < kMur; k++) if (haut[k] > -Infinity) pleines++
  if (pleines < kMur * 0.5) return { etat: 'inconnu' }

  // Suivre le toit vers l'extérieur : un vide de plus de 60 cm l'arrête.
  let k = kMur - 1
  while (k >= 0 && haut[k] === -Infinity) k--
  if (k < 0) return { etat: 'inconnu' }
  for (;;) {
    let suivant = k + 1
    while (suivant < nb && suivant - k <= 3 && haut[suivant] === -Infinity) suivant++
    if (suivant >= nb || haut[suivant] === -Infinity) break
    // Une chute de plus d'un mètre qui se prolonge sur 80 cm : un toit plus bas commence.
    if (haut[k] - haut[suivant] > 1 && DEDANS + suivant * TRANCHE > 0) {
      let bas = 0
      for (let j = suivant; j < Math.min(nb, suivant + 4); j++) if (haut[j] > -Infinity && haut[k] - haut[j] > 1) bas++
      if (bas >= 3) return { etat: 'marche', bord: (loin[k] + DEDANS + suivant * TRANCHE) / 2 }
    }
    k = suivant
  }
  const dernier = loin[k]
  if (dernier > DEHORS) return { etat: 'inconnu' }
  const solApres = sol.filter((s) => s > dernier - 0.1).sort((x, y) => x - y)[0]
  if (solApres === undefined || solApres - dernier > 1.5) {
    return { etat: feuillage.some((s) => s > dernier && s < dernier + 1.5) ? 'cache' : 'inconnu' }
  }
  // L'écart attendu entre le dernier point et le vrai bord : un point par
  // (densité × largeur de bande) mètres, sur la surface suivie.
  const densite = nToit / (-DEDANS * 2 * DEMI_LARGEUR)
  const pas = densite > 0 ? 1 / (densite * 2 * DEMI_LARGEUR) : 0.1
  return { etat: 'mesure', bord: dernier + Math.min(pas, Math.max(0, solApres - dernier) / 2) }
}
