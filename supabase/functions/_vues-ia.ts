// Les VUES que l'IA regarde : la photo aérienne de l'IGN vue de dessus, avec sa
// grille de coordonnées, et quatre vues obliques (nord, sud, est, ouest)
// CALCULÉES — le relief LiDAR recouvert de la photo. Sans Deno ni réseau (sauf
// `chargerOrtho`).
//
// POURQUOI DES VUES OBLIQUES CALCULÉES
//
// Voir un toit d'en haut ne dit pas s'il est à 3 m ou à 9 m, si une terrasse
// est de plain-pied ou en hauteur. Sous quatre angles, les volumes se lisent.
// Google Earth ferait plus joli ; ses conditions interdisent d'en tirer des
// mesures ou de le donner à une IA. Ici tout vient de l'IGN, dans le même repère
// que le laser : ce que l'IA voit se superpose exactement à ce qu'on mesure.
//
// LES COORDONNÉES DE L'IA
//
// Sur la vue de dessus, l'IA lit des coordonnées de 0 à 1000 (x de gauche à
// droite, y de haut en bas) grâce à une grille chiffrée. Ses tracés s'expriment
// dans ce repère : `versLambert` les ramène au repère du laser.

import { urlOrtho } from './_materiaux.ts'
import type { Nuage } from './_copc.ts'
import { decoderPng, encoderPng, type ImagePng } from './_png.ts'
import type { Cadre } from './_preuves.ts'

export type Vue = 'dessus' | 'photo' | 'nord' | 'sud' | 'est' | 'ouest'
export const VUES: Vue[] = ['dessus', 'photo', 'nord', 'sud', 'est', 'ouest']

/** Un point de la vue de dessus, en coordonnées de l'IA (0 à 1000, y vers le bas). */
export type UV = [number, number]

/** De l'image de l'IA (0 à 1000) au repère du laser (Lambert-93, mètres). */
export const versLambert = ([u, v]: UV, cadre: Cadre): [number, number] => [
  cadre.bbox[0] + (u / 1000) * (cadre.bbox[2] - cadre.bbox[0]),
  cadre.bbox[3] - (v / 1000) * (cadre.bbox[3] - cadre.bbox[1]),
]

/** Du repère du laser à l'image de l'IA. */
export const versUV = ([x, y]: [number, number], cadre: Cadre): UV => [
  ((x - cadre.bbox[0]) / (cadre.bbox[2] - cadre.bbox[0])) * 1000,
  ((cadre.bbox[3] - y) / (cadre.bbox[3] - cadre.bbox[1])) * 1000,
]

// ---------- La photo aérienne, en pixels ----------

export interface Ortho extends ImagePng {
  /** Le cadre de la photo, en Lambert-93. */
  bbox: [number, number, number, number]
  /** Résolution demandée (cm par pixel). */
  resolutionCm: number
}

/** La photo aérienne du cadre, décodée. Réessaie : l'IGN répond parfois « couche inconnue ». */
export async function chargerOrtho(cadre: Cadre, tresFine: boolean): Promise<Ortho> {
  let derniere: unknown = new Error('photo_ign_indisponible')
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(urlOrtho(cadre.bbox, cadre.largeur, cadre.hauteur, tresFine, 'image/png'), { signal: AbortSignal.timeout(25000) })
      if (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/png')) {
        const img = await decoderPng(new Uint8Array(await r.arrayBuffer()))
        return { ...img, bbox: cadre.bbox, resolutionCm: tresFine ? 5 : 20 }
      }
      await r.body?.cancel()
    } catch (e) {
      derniere = e
    }
    await new Promise((ok) => setTimeout(ok, 800 * (i + 1)))
  }
  throw derniere instanceof Error ? derniere : new Error('photo_ign_indisponible')
}

/** La couleur de la photo en (x, y) Lambert-93. */
function couleurOrtho(o: Ortho, x: number, y: number): [number, number, number] {
  const px = Math.min(o.largeur - 1, Math.max(0, Math.floor(((x - o.bbox[0]) / (o.bbox[2] - o.bbox[0])) * o.largeur)))
  const py = Math.min(o.hauteur - 1, Math.max(0, Math.floor(((o.bbox[3] - y) / (o.bbox[3] - o.bbox[1])) * o.hauteur)))
  const k = (py * o.largeur + px) * 4
  return [o.rgba[k], o.rgba[k + 1], o.rgba[k + 2]]
}

// ---------- Le relief ----------

export interface Relief {
  bbox: [number, number, number, number]
  cellule: number
  nx: number
  ny: number
  /** Altitude du point le plus haut de chaque case (m, IGN69). */
  z: Float32Array
  /** L'altitude du sol : la plus basse du cadre, pour le pied des façades. */
  zBas: number
  /** Les cases dont le sommet est de la végétation : dessinées en vert, pas en mur. */
  arbre: Uint8Array
  /** L'altitude du sol, case par case (m) : lue dans les points de sol, comblée sous les toits et les arbres. */
  sol: Float32Array
}

/** Le relief d'un cadre : le point le plus haut de chaque case, les trous comblés. */
export function reliefDe(nu: Nuage, cadre: Cadre, cellule = 0.2): Relief {
  const [minX, minY, maxX, maxY] = cadre.bbox
  const nx = Math.ceil((maxX - minX) / cellule), ny = Math.ceil((maxY - minY) / cellule)
  const z = new Float32Array(nx * ny).fill(NaN)
  const arbre = new Uint8Array(nx * ny)
  const sol = new Float32Array(nx * ny).fill(NaN)
  for (let i = 0; i < nu.nb; i++) {
    // Le bruit et les points isolés ne comptent pas.
    if (nu.classe[i] === 1 || nu.classe[i] === 7 || nu.classe[i] === 18) continue
    const cx = Math.floor((nu.x[i] - minX) / cellule), cy = Math.floor((nu.y[i] - minY) / cellule)
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue
    const c = cy * nx + cx
    // Le sol : le plus bas des points de sol de la case (la voiture, le muret ne le relèvent pas).
    if (nu.classe[i] === 2 && (Number.isNaN(sol[c]) || nu.z[i] < sol[c])) sol[c] = nu.z[i]
    if (Number.isNaN(z[c]) || nu.z[i] > z[c]) {
      z[c] = nu.z[i]
      arbre[c] = nu.classe[i] >= 3 && nu.classe[i] <= 5 ? 1 : 0
    }
  }
  // Le sol partout, en comblant de proche en proche : sous les arbres et les toits, aucun point de sol.
  for (let passe = 0; passe < 40; passe++) {
    const copie = sol.slice()
    let manque = 0
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const c = y * nx + x
        if (!Number.isNaN(sol[c])) continue
        let s = 0, n = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy
          if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue
          const v = sol[Y * nx + X]
          if (!Number.isNaN(v)) {
            s += v
            n++
          }
        }
        if (n) copie[c] = s / n
        else manque++
      }
    }
    sol.set(copie)
    if (!manque) break
  }
  // Un arbre est dessiné À PLAT : sa couronne cache le toit ou le sol, mais en faire des colonnes de 15 m masque la maison.
  for (let c = 0; c < z.length; c++) if (arbre[c] && !Number.isNaN(sol[c])) z[c] = sol[c]
  // À 15 points par m², une case de 20 cm sur deux est vide : on comble par la moyenne des voisines, jusqu'à 3 passes.
  for (let passe = 0; passe < 3; passe++) {
    const copie = z.slice()
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const c = y * nx + x
        if (!Number.isNaN(z[c])) continue
        let s = 0, n = 0
        for (const d of [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1]) {
          const v = z[c + d]
          if (!Number.isNaN(v)) {
            s += v
            n++
          }
        }
        if (n >= 3) copie[c] = s / n
      }
    }
    z.set(copie)
  }
  // Les pointes isolées (un oiseau, un mât, un branchage) : une case qui dépasse de plus de 1,5 m la médiane de ses huit voisines y retombe.
  const lisse = z.slice()
  for (let y = 1; y < ny - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const c = y * nx + x
      const v = [z[c - 1], z[c + 1], z[c - nx], z[c + nx], z[c - nx - 1], z[c - nx + 1], z[c + nx - 1], z[c + nx + 1]].filter((q) => !Number.isNaN(q)).sort((a, b) => a - b)
      if (v.length >= 5 && z[c] - v[Math.floor(v.length / 2)] > 1.5) lisse[c] = v[Math.floor(v.length / 2)]
    }
  }
  z.set(lisse)
  let zBas = Infinity
  for (const v of z) if (!Number.isNaN(v) && v < zBas) zBas = v
  for (let c = 0; c < z.length; c++) if (Number.isNaN(z[c])) z[c] = zBas
  return { bbox: cadre.bbox, cellule, nx, ny, z, zBas, arbre, sol }
}

// ---------- Les chiffres et les traits ----------

// Une police de 3 × 5 pixels pour les chiffres : la grille de coordonnées et les numéros des tracés.
const CHIFFRES = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
]

function texte(rgba: Uint8Array, W: number, H: number, x: number, y: number, t: string, echelle: number, fond = true) {
  const largeur = t.length * 4 * echelle + echelle
  if (fond) fillRect(rgba, W, H, x - echelle, y - echelle, largeur + echelle, 7 * echelle, [255, 255, 255], 0.85)
  for (let i = 0; i < t.length; i++) {
    const g = CHIFFRES[t.charCodeAt(i) - 48]
    if (!g) continue
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (g[r * 3 + c] === '1') fillRect(rgba, W, H, x + (i * 4 + c) * echelle, y + r * echelle, echelle, echelle, [15, 15, 15], 1)
      }
    }
  }
}

function fillRect(rgba: Uint8Array, W: number, H: number, x: number, y: number, w: number, h: number, c: [number, number, number], alpha: number) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const k = (py * W + px) * 4
      rgba[k] = rgba[k] * (1 - alpha) + c[0] * alpha
      rgba[k + 1] = rgba[k + 1] * (1 - alpha) + c[1] * alpha
      rgba[k + 2] = rgba[k + 2] * (1 - alpha) + c[2] * alpha
      rgba[k + 3] = 255
    }
  }
}

function trait(rgba: Uint8Array, W: number, H: number, a: [number, number], b: [number, number], c: [number, number, number], epaisseur = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n
    fillRect(rgba, W, H, x - epaisseur / 2, y - epaisseur / 2, epaisseur, epaisseur, c, 1)
  }
}

// ---------- La vue de dessus, avec sa grille ----------

/** La photo aérienne, avec une grille de 0 à 1000 (un trait et un chiffre tous les 100). */
export async function vueDessus(o: Ortho, grille = true): Promise<Uint8Array> {
  const rgba = o.rgba.slice()
  if (grille) {
    const W = o.largeur, H = o.hauteur
    for (let g = 0; g <= 1000; g += 100) {
      const px = (g / 1000) * (W - 1), py = (g / 1000) * (H - 1)
      fillRect(rgba, W, H, px, 0, 1, H, [255, 255, 255], 0.35)
      fillRect(rgba, W, H, 0, py, W, 1, [255, 255, 255], 0.35)
    }
    // Les chiffres à part, par-dessus tous les traits : en haut pour x, à gauche pour y, et au croisement du milieu.
    for (let g = 100; g < 1000; g += 100) {
      const px = (g / 1000) * (W - 1), py = (g / 1000) * (H - 1)
      texte(rgba, W, H, px + 3, 3, String(g), 2)
      texte(rgba, W, H, 3, py + 3, String(g), 2)
    }
  }
  return await encoderPng(rgba, o.largeur, o.hauteur)
}

// ---------- La vue de dessus du LASER ----------

/**
 * Le relief vu de dessus, ombré : chaque facette de toit a son ton selon son
 * exposition, les niveaux du terrain se lisent à la teinte. C'est LA vue sur
 * laquelle l'IA trace : elle est dans le repère exact du laser.
 *
 * Pas la photo : une photo aérienne orthorectifiée l'est sur le TERRAIN, pas sur
 * les toits. Un toit de 9 m y est décalé de un à deux mètres selon sa place dans
 * l'image (parallaxe) ; des pans tracés dessus tombent à côté des points qu'ils
 * devraient mesurer.
 */
export function imageLaser(relief: Relief, largeur: number, hauteur: number, ortho?: Ortho): Ortho {
  void ortho
  const { nx, ny, z, cellule, bbox, zBas, arbre } = relief
  const rgba = new Uint8Array(largeur * hauteur * 4)
  const at = (i: number, j: number) => z[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]
  // L'altitude lissée sur 3 × 3 cases : le laser a un point tous les 25 cm, la pente d'une case seule est du bruit.
  const lisse = (i: number, j: number) => {
    let s = 0
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += at(i + di, j + dj)
    return s / 9
  }
  const hsv = (h: number, sat: number, val: number): [number, number, number] => {
    const c = val * sat, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = val - c
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
  }
  for (let py = 0; py < hauteur; py++) {
    const y = bbox[3] - ((py + 0.5) / hauteur) * (bbox[3] - bbox[1])
    const j = Math.min(ny - 1, Math.floor((y - bbox[1]) / cellule))
    for (let px = 0; px < largeur; px++) {
      const x = bbox[0] + ((px + 0.5) / largeur) * (bbox[2] - bbox[0])
      const i = Math.min(nx - 1, Math.floor((x - bbox[0]) / cellule))
      const h = at(i, j) - zBas
      // La pente sur trois cases de chaque côté.
      const gx = (lisse(i + 2, j) - lisse(i - 2, j)) / (4 * cellule), gy = (lisse(i, j + 2) - lisse(i, j - 2)) / (4 * cellule)
      const pente = Math.hypot(gx, gy)
      let c: [number, number, number]
      if (arbre[j * nx + i]) c = [96, 160, 96]
      else if (pente < 0.1) {
        // Plat : un gris qui monte avec la hauteur (le sol foncé, les terrasses et toits plats plus clairs).
        const g = 70 + Math.min(150, h * 16)
        c = [g, g, g + 8]
      } else {
        // Pentu : la teinte dit l'exposition (vers où le pan descend), la saturation la pente.
        const aspect = ((Math.atan2(gx, gy) * 180) / Math.PI + 360) % 360
        // Près du sol (talus, pelouse en pente), la teinte s'éteint : elle est pour les toits.
        const vif = h < 2.5 ? 0.18 : 1
        c = hsv(aspect, Math.min(0.9, 0.35 + pente * 0.9) * vif, 0.55 + 0.4 * Math.max(0, Math.min(1, 0.5 + (-gx + gy) * 0.3)))
      }
      const k = (py * largeur + px) * 4
      rgba[k] = c[0]
      rgba[k + 1] = c[1]
      rgba[k + 2] = c[2]
      rgba[k + 3] = 255
    }
  }
  return { largeur, hauteur, rgba, bbox, resolutionCm: Math.round(((bbox[2] - bbox[0]) / largeur) * 100) }
}

// ---------- Les vues obliques ----------

/** La direction d'où l'on regarde : la caméra est au nord, au sud… de la maison. */
const CAMERA: Record<Exclude<Vue, 'dessus' | 'photo'>, { c: [number, number]; droite: [number, number] }> = {
  // c : du centre vers la caméra ; droite : vers la droite de l'écran (est pour qui regarde vers le nord).
  sud: { c: [0, -1], droite: [1, 0] },
  nord: { c: [0, 1], droite: [-1, 0] },
  ouest: { c: [-1, 0], droite: [0, 1] },
  est: { c: [1, 0], droite: [0, -1] },
}

const FACADE: [number, number, number] = [214, 207, 194]

/**
 * Une vue oblique : le relief recouvert de la photo, vu d'un côté, à 40° au-dessus
 * de l'horizon. Les cases se dessinent de la plus lointaine à la plus proche ;
 * chacune a son dessus (couleur de la photo) et sa façade (un ton de mur, ombré
 * selon la face). Les toits paraissent à leur vraie hauteur.
 */
export async function vueOblique(relief: Relief, o: Ortho, vue: Exclude<Vue, 'dessus' | 'photo'>, largeur = 1024, elevationDeg = 40): Promise<Uint8Array> {
  const { nx, ny, z, cellule, bbox, zBas, arbre } = relief
  const { c, droite } = CAMERA[vue]
  const el = (elevationDeg * Math.PI) / 180
  const cosE = Math.cos(el), sinE = Math.sin(el)
  const xm = (i: number) => bbox[0] + (i + 0.5) * cellule
  const ym = (j: number) => bbox[1] + (j + 0.5) * cellule
  // Les coordonnées écran d'une case : à droite, et « en haut » (la hauteur, plus la profondeur qui fait monter le lointain).
  const sx = (i: number, j: number) => xm(i) * droite[0] + ym(j) * droite[1]
  const sy = (i: number, j: number, h: number) => h * cosE - (xm(i) * c[0] + ym(j) * c[1]) * sinE
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [i, j] of [[0, 0], [nx - 1, 0], [0, ny - 1], [nx - 1, ny - 1]]) {
    minX = Math.min(minX, sx(i, j)); maxX = Math.max(maxX, sx(i, j))
    for (const h of [0, 12]) {
      minY = Math.min(minY, sy(i, j, h)); maxY = Math.max(maxY, sy(i, j, h))
    }
  }
  const echelle = (largeur - 8) / (maxX - minX + cellule)
  const W = largeur, H = Math.ceil((maxY - minY + cellule) * echelle) + 8
  const rgba = new Uint8Array(W * H * 4)
  for (let k = 0; k < rgba.length; k += 4) {
    rgba[k] = 232
    rgba[k + 1] = 238
    rgba[k + 2] = 245
    rgba[k + 3] = 255
  }
  const cw = Math.max(1, Math.ceil(cellule * echelle) + 1)
  const ch = Math.max(1, Math.ceil(cellule * sinE * echelle) + 1)
  // Le ton d'une façade selon sa face : les faces au nord et à l'ouest sont dans l'ombre.
  const ombre = (vue === 'sud' ? 1 : vue === 'est' ? 0.92 : vue === 'ouest' ? 0.85 : 0.78)
  // Du plus lointain (grande profondeur) au plus proche : le produit scalaire avec la direction de la caméra, croissant.
  const cases = Array.from({ length: nx * ny }, (_, k) => k)
  const prof = (k: number) => xm(k % nx) * c[0] + ym(Math.floor(k / nx)) * c[1]
  cases.sort((a, b) => prof(a) - prof(b))
  const pixelX = (v: number) => Math.round((v - minX) * echelle) + 4
  const pixelY = (v: number) => Math.round((maxY - v) * echelle) + 4
  for (const k of cases) {
    const i = k % nx, j = Math.floor(k / nx)
    const h = z[k] - zBas
    const x = pixelX(sx(i, j))
    const yHaut = pixelY(sy(i, j, h))
    // La façade ne descend que jusqu'au sommet de la case devant elle (vers la caméra) : un mur, pas une colonne jusqu'au fond.
    const vi = i + c[0], vj = j + c[1]
    const devant = vi >= 0 && vj >= 0 && vi < nx && vj < ny ? z[vj * nx + vi] - zBas : 0
    const yPied = pixelY(sy(i, j, Math.min(h, Math.max(0, devant))))
    const [r, g, b] = couleurOrtho(o, xm(i), ym(j))
    if (yPied > yHaut) {
      // Un arbre n'est pas un mur : sa colonne prend le vert de la photo.
      const [pr, pg, pb] = arbre[k] ? [r * 0.7, g * 0.75, b * 0.7] : FACADE
      // La façade : plus sombre vers le bas.
      const n = yPied - yHaut
      for (let t = 0; t < n; t += 2) {
        const teinte = ombre * (1 - 0.25 * (t / Math.max(1, n)))
        fillRect(rgba, W, H, x, yHaut + ch + t, cw, 2, [pr * teinte, pg * teinte, pb * teinte], 1)
      }
    }
    fillRect(rgba, W, H, x, yHaut, cw, ch, [r, g, b], 1)
  }
  return await encoderPng(rgba, W, H)
}

// ---------- Les tracés de l'IA, par-dessus la photo ----------

export interface TraceVisible {
  id: number
  /** Polygone (fermé) ou ligne, en coordonnées de l'IA. */
  points: UV[]
  ferme: boolean
  couleur: [number, number, number]
}

/** La photo avec les tracés en couleur et leurs numéros : pour que l'IA vérifie où ils tombent. */
export async function vueAvecTraces(o: Ortho, traces: TraceVisible[], grille = true): Promise<Uint8Array> {
  const W = o.largeur, H = o.hauteur
  const rgba = o.rgba.slice()
  const px = ([u, v]: UV): [number, number] => [(u / 1000) * (W - 1), (v / 1000) * (H - 1)]
  for (const t of traces) {
    if (t.ferme && t.points.length >= 3) {
      // Un voile de la couleur du tracé, par balayage.
      const P = t.points.map(px)
      const y0 = Math.max(0, Math.floor(Math.min(...P.map((p) => p[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...P.map((p) => p[1]))))
      for (let y = y0; y <= y1; y++) {
        const xs: number[] = []
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length]
          if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
        }
        xs.sort((p, q) => p - q)
        for (let k = 0; k + 1 < xs.length; k += 2) fillRect(rgba, W, H, xs[k], y, xs[k + 1] - xs[k], 1, t.couleur, 0.28)
      }
    }
    const P = t.points.map(px)
    const n = t.ferme ? P.length : P.length - 1
    for (let i = 0; i < n; i++) trait(rgba, W, H, P[i], P[(i + 1) % P.length], t.couleur, 2)
    const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length
    texte(rgba, W, H, cx - 4, cy - 5, String(t.id), 2)
  }
  if (grille) {
    for (let g = 100; g < 1000; g += 100) {
      const x = (g / 1000) * (W - 1), y = (g / 1000) * (H - 1)
      texte(rgba, W, H, x + 3, 3, String(g), 2)
      texte(rgba, W, H, 3, y + 3, String(g), 2)
    }
  }
  return await encoderPng(rgba, W, H)
}
