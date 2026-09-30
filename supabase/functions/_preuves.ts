// Le DOSSIER DE PREUVES que l'IA lit : la photo aérienne de l'IGN, et à côté,
// alignée pixel pour pixel, la carte des hauteurs mesurées par le laser — les
// toits en dégradé, chaque niveau du terrain teinté, le contour de la maison en
// noir. Sans Deno ni réseau : la carte se dessine ici, dans un PNG.
//
// POURQUOI UNE CARTE À NOUS
//
// La photo montre ce qu'on voit ; elle ne dit ni qu'une terrasse est à
// 1,7 m au-dessus du jardin, ni où passe le mur de soutènement. La carte des
// hauteurs le dit, avec les mêmes contours que la photo : l'IA rapproche les
// deux, comme un métreur qui a la photo et le plan côte à côte.

import { versLambert93 } from './_calcul-toit.ts'
import type { Nuage } from './_copc.ts'
import { encoderPng } from './_png.ts'
import type { Niveaux, XY } from './_niveaux.ts'
import { couleurNiveau } from './_scene-ia.ts'
import type { Releve } from './_releve.ts'

/** Autour de la maison, de quoi voir le jardin, la terrasse basse, l'escalier. */
export const MARGE_CADRE_M = 8

export interface Cadre {
  /** Lambert-93 : [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number]
  largeur: number
  hauteur: number
}

/** Le cadre commun aux deux images : la maison et sa marge, à 1024 px au plus. */
export function cadreDeLaMaison(r: Releve, resolutionCm: number, marge = MARGE_CADRE_M): Cadre {
  const P = r.murs.map(([lon, lat]) => versLambert93(lon, lat))
  const minX = Math.min(...P.map((p) => p[0])) - marge, maxX = Math.max(...P.map((p) => p[0])) + marge
  const minY = Math.min(...P.map((p) => p[1])) - marge, maxY = Math.max(...P.map((p) => p[1])) + marge
  const w = maxX - minX, h = maxY - minY
  const k = Math.min(1024, Math.max(640, Math.max(w, h) / (resolutionCm / 100))) / Math.max(w, h)
  return { bbox: [minX, minY, maxX, maxY], largeur: Math.round(w * k), hauteur: Math.round(h * k) }
}

const CELLULE = 0.25

/**
 * La carte des hauteurs : le point le plus haut de chaque case de 25 cm,
 * comblé, ombré, teinté par niveau, avec le contour de la maison.
 */
export async function carteDesHauteurs(nu: Nuage, r: Releve, n: Niveaux, cadre: Cadre): Promise<Uint8Array> {
  const [minX, minY, maxX, maxY] = cadre.bbox
  const cx = Math.ceil((maxX - minX) / CELLULE), cy = Math.ceil((maxY - minY) / CELLULE)
  const dsm = new Float32Array(cx * cy).fill(NaN)
  // Les arbres : à part. Ils cachent le toit ou le sol, on les dessine en vert plutôt qu'en relief.
  const arbre = new Uint8Array(cx * cy)
  for (let i = 0; i < nu.nb; i++) {
    const cl = nu.classe[i]
    const x = Math.floor((nu.x[i] - minX) / CELLULE), y = Math.floor((nu.y[i] - minY) / CELLULE)
    if (x < 0 || y < 0 || x >= cx || y >= cy) continue
    const c = y * cx + x
    if (cl === 4 || cl === 5) {
      arbre[c] = 1
      continue
    }
    // Le bruit ne compte pas : on dessine le bâti et le sol.
    if (cl === 1 || cl === 7 || cl === 18 || cl === 3) continue
    if (Number.isNaN(dsm[c]) || nu.z[i] > dsm[c]) dsm[c] = nu.z[i]
  }
  // Les trous d'une case (un point tous les 25 cm en moyenne) : la moyenne des voisines, deux fois.
  for (let passe = 0; passe < 2; passe++) {
    const copie = dsm.slice()
    for (let y = 1; y < cy - 1; y++) {
      for (let x = 1; x < cx - 1; x++) {
        const c = y * cx + x
        if (!Number.isNaN(dsm[c])) continue
        const v = [dsm[c - 1], dsm[c + 1], dsm[c - cx], dsm[c + cx]].filter((q) => !Number.isNaN(q))
        if (v.length >= 2) copie[c] = v.reduce((s, q) => s + q, 0) / v.length
      }
    }
    dsm.set(copie)
  }

  const [ox, oy] = r.origine
  const loc = ([lon, lat]: [number, number]): XY => {
    const [x, y] = versLambert93(lon, lat)
    return [x - ox, y - oy]
  }
  const murs = r.murs.map(loc)
  const dalles = r.pans
    .filter((p) => p.terrasse)
    .map((p) => ({ P: p.contour.map(loc), niveau: n.niveaux.find((v) => v.origine === 'dalle' && Math.abs(v.aire - p.airePlan) < 0.05)?.id ?? -1 }))
  const g = n.grille
  const teinte = (px: number, py: number): number => {
    // Coordonnées locales du centre de la case.
    const lx = minX + (px + 0.5) * CELLULE - ox, ly = minY + (py + 0.5) * CELLULE - oy
    for (const d of dalles) if (d.niveau >= 0 && dans([lx, ly], d.P)) return d.niveau
    if (!g) return -1
    const gx = Math.floor((lx - g.x0) / g.pas), gy = Math.floor((ly - g.y0) / g.pas)
    return gx >= 0 && gy >= 0 && gx < g.nx && gy < g.ny ? g.label[gy * g.nx + gx] : -1
  }

  const W = cadre.largeur, H = cadre.hauteur
  const rgba = new Uint8Array(W * H * 4)
  const zBase = r.zSol
  const pixels = (cadre.bbox[2] - cadre.bbox[0]) / W
  for (let py = 0; py < H; py++) {
    // L'image a le nord en haut : la ligne 0 est en haut du cadre.
    const yy = Math.min(cy - 1, Math.floor(((H - 1 - py) * pixels) / CELLULE))
    for (let px = 0; px < W; px++) {
      const xx = Math.min(cx - 1, Math.floor((px * pixels) / CELLULE))
      const c = yy * cx + xx
      const z = dsm[c]
      let R = 235, G = 238, B = 242
      if (Number.isNaN(z) && arbre[c]) {
        R = 150
        G = 210
        B = 150
      }
      if (!Number.isNaN(z)) {
        // Ombrage : la pente vers le nord-ouest éclaire.
        const zE = dsm[Math.min(cx - 1, xx + 1) + yy * cx], zO = dsm[Math.max(0, xx - 1) + yy * cx]
        const zN = dsm[xx + Math.min(cy - 1, yy + 1) * cx], zS = dsm[xx + Math.max(0, yy - 1) * cx]
        const gx = Number.isNaN(zE) || Number.isNaN(zO) ? 0 : (zE - zO) / (2 * CELLULE)
        const gy = Number.isNaN(zN) || Number.isNaN(zS) ? 0 : (zN - zS) / (2 * CELLULE)
        const ombre = Math.max(-0.25, Math.min(0.25, (-gx + gy) * 0.08))
        const h = z - zBase
        const gris = Math.max(70, Math.min(235, 150 + h * 9)) * (1 + ombre)
        R = G = B = Math.max(0, Math.min(255, gris))
        const t = teinte(xx, yy)
        if (arbre[c] && t < 0) {
          // Sous ou contre un arbre : vert clair, pour que l'IA sache que la vue est cachée.
          R = R * 0.5 + 60 * 0.5
          G = G * 0.5 + 190 * 0.5
          B = B * 0.5 + 90 * 0.5
        }
        if (t >= 0) {
          const [tr, tg, tb] = couleurNiveau(t).rgb
          // La teinte du niveau, gardant un peu du relief.
          R = R * 0.35 + tr * 0.65
          G = G * 0.35 + tg * 0.65
          B = B * 0.35 + tb * 0.65
        }
      }
      const k = (py * W + px) * 4
      rgba[k] = R
      rgba[k + 1] = G
      rgba[k + 2] = B
      rgba[k + 3] = 255
    }
  }
  // Le contour de la maison, en noir.
  const aPixel = ([x, y]: XY): [number, number] => [(x + ox - minX) / pixels, H - 1 - (y + oy - minY) / pixels]
  for (let i = 0; i < murs.length; i++) trait(rgba, W, H, aPixel(murs[i]), aPixel(murs[(i + 1) % murs.length]), 2)
  return await encoderPng(rgba, W, H)
}

function trait(rgba: Uint8Array, W: number, H: number, a: [number, number], b: [number, number], epaisseur: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n
    for (let dy = -epaisseur / 2; dy <= epaisseur / 2; dy++) {
      for (let dx = -epaisseur / 2; dx <= epaisseur / 2; dx++) {
        const px = Math.round(x + dx), py = Math.round(y + dy)
        if (px < 0 || py < 0 || px >= W || py >= H) continue
        const k = (py * W + px) * 4
        rgba[k] = rgba[k + 1] = rgba[k + 2] = 10
      }
    }
  }
}

function dans(p: XY, P: XY[]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}
