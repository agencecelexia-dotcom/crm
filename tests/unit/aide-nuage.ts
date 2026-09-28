// Des nuages de points synthétiques, aux dimensions connues : le relevé doit
// les retrouver. Tirage pseudo-aléatoire à graine fixe, pour des tests stables.

import { depuisLambert93 } from '../../supabase/functions/_calcul-toit'
import type { Nuage, Zone } from '../../supabase/functions/_copc'

export function hasard(graine: number) {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Un bâtiment : son contour de murs (repère local, mètres) et la hauteur de son toit. */
export interface Volume {
  /** Le toit en (x, y) locaux : hauteur au-dessus du sol, ou null hors du toit. */
  toit: (x: number, y: number) => number | null
}

export interface Scene {
  /** Origine du repère local, en Lambert-93, et rotation du repère (degrés). */
  origine: [number, number]
  rotation: number
  volumes: Volume[]
  /** Points par m², bruit vertical (m). */
  densite?: number
  bruit?: number
  /** Demi-côté de la zone, en mètres. */
  demiCote?: number
  graine?: number
}

/** Le nuage d'une scène : du sol partout, du bâtiment sous les toits. */
export function nuageDe(s: Scene): { nuage: Nuage; zone: Zone } {
  const alea = hasard(s.graine ?? 7)
  const densite = s.densite ?? 20, bruit = s.bruit ?? 0.03, R = s.demiCote ?? 20
  const pas = 1 / Math.sqrt(densite)
  const th = (s.rotation * Math.PI) / 180
  const x: number[] = [], y: number[] = [], z: number[] = [], classe: number[] = []
  const SOL = 200
  for (let u = -R; u < R; u += pas) {
    for (let v = -R; v < R; v += pas) {
      const lu = u + alea() * pas, lv = v + alea() * pas
      let haut: number | null = null
      for (const vol of s.volumes) {
        const t = vol.toit(lu, lv)
        if (t !== null && (haut === null || t > haut)) haut = t
      }
      x.push(s.origine[0] + lu * Math.cos(th) - lv * Math.sin(th))
      y.push(s.origine[1] + lu * Math.sin(th) + lv * Math.cos(th))
      z.push(SOL + (haut ?? 0) + (alea() - 0.5) * 2 * bruit * Math.sqrt(3))
      classe.push(haut === null ? 2 : 6)
    }
  }
  const zone: Zone = {
    minX: Math.min(...x),
    minY: Math.min(...y),
    maxX: Math.max(...x),
    maxY: Math.max(...y),
  }
  return {
    nuage: { x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z), classe: Uint8Array.from(classe), nb: x.length },
    zone,
  }
}

/** Un rectangle de murs [x0, x1] × [y0, y1] du repère local, en longitude, latitude, décalé de (dx, dy) mètres (Lambert-93). */
export function contourDe(
  s: Pick<Scene, 'origine' | 'rotation'>,
  [x0, y0, x1, y1]: [number, number, number, number],
  [dx, dy]: [number, number] = [0, 0],
): [number, number][] {
  const th = (s.rotation * Math.PI) / 180
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([u, v]) =>
    depuisLambert93(
      s.origine[0] + u * Math.cos(th) - v * Math.sin(th) + dx,
      s.origine[1] + u * Math.sin(th) + v * Math.cos(th) + dy,
    ),
  )
}

/**
 * Un toit à deux pans sur des murs [−l/2, l/2] × [y0, y1] : faîtage selon y,
 * pente `p` (rapport), débord `d` (tous côtés, sauf ceux de `sansDebord`),
 * dessus du toit à `h` mètres au droit des murs.
 */
export function deuxPans(o: {
  l: number
  y0: number
  y1: number
  p: number
  d: number
  h: number
  sansDebord?: ('y0' | 'y1')[]
}): Volume {
  const dy0 = o.sansDebord?.includes('y0') ? 0 : o.d
  const dy1 = o.sansDebord?.includes('y1') ? 0 : o.d
  return {
    toit: (x, y) => {
      if (Math.abs(x) > o.l / 2 + o.d || y < o.y0 - dy0 || y > o.y1 + dy1) return null
      return o.h + o.p * (o.l / 2 - Math.abs(x))
    },
  }
}

/** Un toit à quatre pans (croupes) de même pente sur des murs [−l/2, l/2] × [−L/2, L/2], L ≥ l. */
export function quatrePans(o: { l: number; L: number; p: number; d: number; h: number }): Volume {
  return {
    toit: (x, y) => {
      if (Math.abs(x) > o.l / 2 + o.d || Math.abs(y) > o.L / 2 + o.d) return null
      return o.h + o.p * Math.min(o.l / 2 - Math.abs(x), o.L / 2 - Math.abs(y))
    },
  }
}
