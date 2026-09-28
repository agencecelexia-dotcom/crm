// Les points d'une maison : leur stockage compact, et les outils de base pour
// les analyser (voisinage, sol). Sans Deno ni réseau.

import type { Nuage, Zone } from './_copc.ts'

// ---------- Stockage compact ----------
//
// Un extrait se garde pour être ré-analysé sans retélécharger (l'IGN met 20 à
// 60 s à le servir). En centimètres autour de l'origine de la zone, et par
// colonnes : les x ensemble, puis les y… — ce qui se compresse bien.

const MAGIE = 0x4e554147 // « NUAG »

export function encoderNuage(nuages: Nuage[], zone: Zone): Uint8Array {
  const n = nuages.reduce((s, x) => s + x.nb, 0)
  const z0 = Math.floor(Math.min(...nuages.flatMap((nu) => (nu.nb ? [Math.min(...nu.z)] : [0]))))
  const octets = new Uint8Array(32 + n * 13)
  const dv = new DataView(octets.buffer)
  dv.setUint32(0, MAGIE, true)
  dv.setUint32(4, 1, true) // version
  dv.setFloat64(8, zone.minX, true)
  dv.setFloat64(16, zone.minY, true)
  dv.setInt32(24, z0, true)
  dv.setUint32(28, n, true)
  let k = 0
  for (const nu of nuages) {
    for (let i = 0; i < nu.nb; i++, k++) {
      dv.setInt32(32 + k * 4, Math.round((nu.x[i] - zone.minX) * 100), true)
      dv.setInt32(32 + n * 4 + k * 4, Math.round((nu.y[i] - zone.minY) * 100), true)
      dv.setInt32(32 + n * 8 + k * 4, Math.round((nu.z[i] - z0) * 100), true)
      octets[32 + n * 12 + k] = nu.classe[i]
    }
  }
  return octets
}

export function decoderNuage(octets: Uint8Array): Nuage & { origine: [number, number, number] } {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  if (dv.getUint32(0, true) !== MAGIE) throw new Error('nuage_signature')
  const x0 = dv.getFloat64(8, true)
  const y0 = dv.getFloat64(16, true)
  const z0 = dv.getInt32(24, true)
  const n = dv.getUint32(28, true)
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), classe = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    x[k] = x0 + dv.getInt32(32 + k * 4, true) / 100
    y[k] = y0 + dv.getInt32(32 + n * 4 + k * 4, true) / 100
    z[k] = z0 + dv.getInt32(32 + n * 8 + k * 4, true) / 100
    classe[k] = octets[32 + n * 12 + k]
  }
  return { x, y, z, classe, nb: n, origine: [x0, y0, z0] }
}

// ---------- Voisinage ----------

/** Une grille de hachage : les points de chaque case de `pas` mètres. */
export class Grille2D {
  readonly cases = new Map<number, number[]>()
  readonly x: ArrayLike<number>
  readonly y: ArrayLike<number>
  readonly pas: number
  constructor(x: ArrayLike<number>, y: ArrayLike<number>, indices: ArrayLike<number>, pas: number) {
    this.x = x
    this.y = y
    this.pas = pas
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k]
      const c = this.cle(Math.floor(x[i] / pas), Math.floor(y[i] / pas))
      const l = this.cases.get(c)
      if (l) l.push(i)
      else this.cases.set(c, [i])
    }
  }
  private cle(cx: number, cy: number) {
    return cx * 1_000_003 + cy
  }
  /** Les points à moins de `r` mètres de (px, py). */
  autour(px: number, py: number, r: number): number[] {
    const sortie: number[] = []
    const c0x = Math.floor((px - r) / this.pas), c1x = Math.floor((px + r) / this.pas)
    const c0y = Math.floor((py - r) / this.pas), c1y = Math.floor((py + r) / this.pas)
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const l = this.cases.get(this.cle(cx, cy))
        if (!l) continue
        for (const i of l) if ((this.x[i] - px) ** 2 + (this.y[i] - py) ** 2 <= r * r) sortie.push(i)
      }
    }
    return sortie
  }
}

// ---------- Sol ----------

/**
 * L'altitude du sol, sur une grille d'un mètre : le quartile bas des points de
 * sol de chaque case (un muret, une voiture mal classée ne la relèvent pas),
 * les trous comblés par la moyenne des cases voisines, élargie jusqu'à trouver.
 */
export function solLocal(nu: Nuage, zone: Zone, pas = 1): (x: number, y: number) => number {
  const nx = Math.ceil((zone.maxX - zone.minX) / pas), ny = Math.ceil((zone.maxY - zone.minY) / pas)
  const parCase: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let i = 0; i < nu.nb; i++) {
    if (nu.classe[i] !== 2) continue
    const cx = Math.floor((nu.x[i] - zone.minX) / pas), cy = Math.floor((nu.y[i] - zone.minY) / pas)
    if (cx >= 0 && cx < nx && cy >= 0 && cy < ny) parCase[cy * nx + cx].push(nu.z[i])
  }
  const grille = new Float64Array(nx * ny).fill(NaN)
  for (let k = 0; k < parCase.length; k++) {
    const v = parCase[k]
    if (!v.length) continue
    v.sort((a, b) => a - b)
    grille[k] = v[Math.floor(v.length * 0.25)]
  }
  // Combler : sous une maison, il n'y a pas de sol mesuré.
  for (let rayon = 1; rayon < Math.max(nx, ny); rayon++) {
    let manque = 0
    const copie = grille.slice()
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        if (!Number.isNaN(grille[cy * nx + cx])) continue
        let s = 0, n = 0
        for (let dy = -rayon; dy <= rayon; dy++) {
          for (let dx = -rayon; dx <= rayon; dx++) {
            const x = cx + dx, y = cy + dy
            if (x < 0 || y < 0 || x >= nx || y >= ny) continue
            const v = grille[y * nx + x]
            if (!Number.isNaN(v)) { s += v; n++ }
          }
        }
        if (n) copie[cy * nx + cx] = s / n
        else manque++
      }
    }
    grille.set(copie)
    if (!manque) break
  }
  return (x, y) => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - zone.minX) / pas)))
    const cy = Math.min(ny - 1, Math.max(0, Math.floor((y - zone.minY) / pas)))
    const v = grille[cy * nx + cx]
    return Number.isNaN(v) ? 0 : v
  }
}
