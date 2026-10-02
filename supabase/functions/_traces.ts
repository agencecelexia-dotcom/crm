// Les TRACÉS de l'IA — contour, pans, terrasse, barrières, escaliers — et leur
// MESURE dans les points LiDAR. Sans Deno ni réseau.
//
// L'IA trace sur la photo aérienne, en coordonnées de 0 à 1000 (`_vues-ia.ts`).
// Ici, chaque tracé est ramené au repère du laser et mesuré : pente et surface
// d'un pan (plan ajusté dans ses points), hauteur des murs sous le contour,
// altitude d'une terrasse, dénivelé d'un escalier. Ces chiffres lui reviennent
// pour qu'elle corrige : c'est le laser qui mesure, jamais elle.

import { cardinal, type Point } from './_geometrie.ts'
import { versLambert93 } from './_calcul-toit.ts'
import type { Releve } from './_releve.ts'
import type { Nuage } from './_copc.ts'
import type { Cadre } from './_preuves.ts'
import { versLambert, versUV, type Relief, type UV } from './_vues-ia.ts'

export const GENRES_TRACE = ['emprise', 'pan', 'terrasse', 'barriere', 'escalier', 'mur_soutenement', 'annexe'] as const
export type GenreTrace = (typeof GENRES_TRACE)[number]

/** Un tracé de l'IA (ou de l'artisan) : un genre, des points en coordonnées de 0 à 1000. */
export interface Trace {
  id: number
  genre: GenreTrace
  points: UV[]
  note: string
}

/** Un genre se trace en polygone fermé, ou en ligne. */
export const EST_LIGNE: Record<GenreTrace, boolean> = {
  emprise: false,
  pan: false,
  terrasse: false,
  annexe: false,
  escalier: false,
  barriere: true,
  mur_soutenement: true,
}

export interface Contexte {
  nuage: Nuage
  cadre: Cadre
  relief: Relief
}

type XY = [number, number]

export interface MesureTrace {
  id: number
  genre: GenreTrace
  /** Ce que le laser en dit, en clair (m, m², %). */
  mesure: Record<string, number | string | null>
  /** Ce qui cloche : tracé trop petit, plan mal ajusté, peu de points… */
  alertes: string[]
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r1 = (v: number) => Math.round(v * 10) / 10

function aire2d(P: XY[]): number {
  let s = 0
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

function dedans(p: XY, P: XY[]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}

function distanceSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const distanceContour = (p: XY, P: XY[]) => Math.min(...P.map((a, i) => distanceSegment(p, a, P[(i + 1) % P.length])))
const mediane = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

/** Le sol en (x, y) Lambert-93 : la grille de sol du relief. */
export function solEn(rel: Relief, x: number, y: number): number {
  const i = Math.min(rel.nx - 1, Math.max(0, Math.floor((x - rel.bbox[0]) / rel.cellule)))
  const j = Math.min(rel.ny - 1, Math.max(0, Math.floor((y - rel.bbox[1]) / rel.cellule)))
  const v = rel.sol[j * rel.nx + i]
  return Number.isNaN(v) ? rel.zBas : v
}

/** Les sommets d'un tracé dans le repère du laser. */
export const enLambert = (t: Trace, cadre: Cadre): XY[] => t.points.map((p) => versLambert(p, cadre))

/**
 * Accrocher les coins : deux sommets de tracés différents à moins de 50 cm n'en
 * font qu'un (leur milieu). Un pan collé à son voisin ne laisse pas de jour.
 */
export function accrocher(traces: Trace[], cadre: Cadre, distance = 0.5): Trace[] {
  const L = traces.map((t) => enLambert(t, cadre))
  const sortie = traces.map((t) => ({ ...t, points: t.points.map((p) => [...p] as UV) }))
  for (let a = 0; a < traces.length; a++) {
    for (let i = 0; i < L[a].length; i++) {
      for (let b = a + 1; b < traces.length; b++) {
        for (let j = 0; j < L[b].length; j++) {
          if (Math.hypot(L[a][i][0] - L[b][j][0], L[a][i][1] - L[b][j][1]) > distance) continue
          const m: UV = [(sortie[a].points[i][0] + sortie[b].points[j][0]) / 2, (sortie[a].points[i][1] + sortie[b].points[j][1]) / 2]
          sortie[a].points[i] = [Math.round(m[0]), Math.round(m[1])]
          sortie[b].points[j] = [Math.round(m[0]), Math.round(m[1])]
          L[a][i] = versLambert(sortie[a].points[i], cadre)
          L[b][j] = versLambert(sortie[b].points[j], cadre)
        }
      }
    }
  }
  return sortie
}

/** Un plan z = a·x + b·y + c ajusté par moindres carrés, en écartant ce qui s'en éloigne (cheminées, lucarnes, bruit). */
export function ajusterPlan(pts: [number, number, number][]): { a: number; b: number; c: number; ecart: number; utilises: number } | null {
  let P = pts
  for (let tour = 0; tour < 4; tour++) {
    if (P.length < 6) return null
    const n = P.length
    let mx = 0, my = 0, mz = 0
    for (const [x, y, z] of P) {
      mx += x
      my += y
      mz += z
    }
    mx /= n
    my /= n
    mz /= n
    let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0
    for (const [x, y, z] of P) {
      const dx = x - mx, dy = y - my, dz = z - mz
      sxx += dx * dx
      sxy += dx * dy
      syy += dy * dy
      sxz += dx * dz
      syz += dy * dz
    }
    const det = sxx * syy - sxy * sxy
    if (det < 1e-6 * n * n) return null
    const a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det
    const c = mz - a * mx - b * my
    const res = P.map(([x, y, z]) => Math.abs(z - (a * x + b * y + c)))
    const rms = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / n)
    const seuil = Math.max(0.1, 2.2 * rms)
    const gardes = P.filter((_, i) => res[i] <= seuil)
    if (tour === 3 || gardes.length === P.length || gardes.length < 6) return { a, b, c, ecart: rms, utilises: n }
    P = gardes
  }
  return null
}

/** Les points de bâtiment (classe 6) dans un polygone, à `marge` mètres de son bord. */
function pointsDans(ctx: Contexte, P: XY[], marge: number, classes = [6]): [number, number, number][] {
  const sortie: [number, number, number][] = []
  const [minX, minY, maxX, maxY] = [Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))]
  const { nuage: nu } = ctx
  for (let i = 0; i < nu.nb; i++) {
    if (!classes.includes(nu.classe[i])) continue
    const x = nu.x[i], y = nu.y[i]
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    if (!dedans([x, y], P)) continue
    if (marge > 0 && distanceContour([x, y], P) < marge) continue
    sortie.push([x, y, nu.z[i]])
  }
  return sortie
}

/** Mesurer un tracé dans les points LiDAR. `autres` : les tracés déjà mesurés (une terrasse au pied d'un mur, par exemple). */
export function mesurerTrace(t: Trace, ctx: Contexte, autres: { trace: Trace; mesure: MesureTrace }[] = []): MesureTrace {
  const alertes: string[] = []
  const base = (mesure: MesureTrace['mesure']): MesureTrace => ({ id: t.id, genre: t.genre, mesure, alertes })
  const min = EST_LIGNE[t.genre] ? 2 : 3
  if (t.points.length < min) return base({ erreur: `il faut au moins ${min} points` })
  const P = enLambert(t, ctx.cadre)
  const longueurLigne = P.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - P[i][0], p[1] - P[i][1]), 0)

  if (t.genre === 'pan') {
    const plan = aire2d(P)
    if (plan < 1) alertes.push('tracé de moins de 1 m² : trop petit pour un pan')
    const pts = pointsDans(ctx, P, 0.15)
    const f = ajusterPlan(pts)
    if (!f) return base({ aire_plan_m2: r1(plan), points: pts.length, erreur: 'pas assez de points de toit pour ajuster un plan' })
    const grad = Math.hypot(f.a, f.b)
    const zs = P.map(([x, y]) => f.a * x + f.b * y + f.c)
    const solAutour = mediane(P.map(([x, y]) => solEn(ctx.relief, x, y)))
    if (f.ecart > 0.15) alertes.push(`les points ne tiennent pas dans un seul plan (écart ${r2(f.ecart)} m) : scinder en plusieurs pans`)
    if (pts.length / Math.max(plan, 0.1) < 3) alertes.push('peu de points de toit dans ce tracé (arbre ou ombre ?)')
    return base({
      pente_pct: r1(grad * 100),
      exposition: grad < 0.05 ? 'plat' : cardinal(((Math.atan2(-f.a, -f.b) * 180) / Math.PI + 360) % 360),
      aire_plan_m2: r1(plan),
      aire_vraie_m2: r1(plan * Math.sqrt(1 + grad * grad)),
      hauteur_bas_m: r2(Math.min(...zs) - solAutour),
      hauteur_haut_m: r2(Math.max(...zs) - solAutour),
      ecart_plan_m: r2(f.ecart),
      points: pts.length,
    })
  }

  if (t.genre === 'terrasse' || t.genre === 'annexe') {
    const plan = aire2d(P)
    const pts = pointsDans(ctx, P, 0.1, [2, 6])
    if (pts.length < 6) return base({ aire_plan_m2: r1(plan), points: pts.length, erreur: 'pas assez de points dans ce tracé' })
    const zs = pts.map((p) => p[2])
    const dalle = mediane(zs)
    // Le sol qui l'entoure : un mètre à un mètre cinquante hors du bord.
    const autour: number[] = []
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.5) continue
      const n: XY = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]
      const sens = aire2dSigne(P) > 0 ? 1 : -1
      for (let s = 0.25; s < L; s += 0.5) {
        const x = a[0] + ((b[0] - a[0]) * s) / L + sens * n[0] * 1.2, y = a[1] + ((b[1] - a[1]) * s) / L + sens * n[1] * 1.2
        if (!dedans([x, y], P)) autour.push(solEn(ctx.relief, x, y))
      }
    }
    const sol = mediane(autour)
    const ecart = Math.sqrt(zs.reduce((s, v) => s + (v - dalle) ** 2, 0) / zs.length)
    if (t.genre === 'terrasse' && ecart > 0.2) {
      // La partie vraiment plate du tracé (à ±12 cm de la dalle) : où elle est, combien elle fait.
      const plats = pts.filter((p) => Math.abs(p[2] - dalle) < 0.12)
      if (plats.length >= 6) {
        const uv = plats.map((p) => versUV([p[0], p[1]], ctx.cadre))
        const u0 = Math.round(Math.min(...uv.map((q) => q[0]))), u1 = Math.round(Math.max(...uv.map((q) => q[0])))
        const v0 = Math.round(Math.min(...uv.map((q) => q[1]))), v1 = Math.round(Math.max(...uv.map((q) => q[1])))
        alertes.push(`la surface n'est pas plate (écart ${r2(ecart)} m) : ton tracé englobe des murs ou du sol à d'autres niveaux. La partie plate à ${r2(dalle)} m se trouve dans le rectangle x ${u0}–${u1}, y ${v0}–${v1} (≈ ${r1(plats.length / (pts.length / plan))} m²) : retrace la terrasse sur elle.`)
      } else alertes.push(`la surface n'est pas plate (écart ${r2(ecart)} m) : est-ce une terrasse ?`)
    }
    return base({
      aire_m2: r1(plan),
      altitude_relative_sol_m: Number.isNaN(sol) ? null : r2(dalle - sol),
      planeite_m: r2(ecart),
      points: pts.length,
    })
  }

  if (t.genre === 'emprise') {
    const plan = aire2d(P)
    const sens = aire2dSigne(P) > 0 ? 1 : -1
    const murs: { longueur: number; hauteur: number; pied: string }[] = []
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const n: XY = [(sens * (b[1] - a[1])) / L, (-sens * (b[0] - a[0])) / L]
      const toits: number[] = [], pieds: number[] = []
      let surTerrasse = 0, lus = 0
      for (let s = 0.25; s < L; s += 0.5) {
        const px = a[0] + ((b[0] - a[0]) * s) / L, py = a[1] + ((b[1] - a[1]) * s) / L
        // Le toit au droit du mur : les points de bâtiment à 30-90 cm en dedans.
        const dedansPts = pointsAutour(ctx, [px - n[0] * 0.6, py - n[1] * 0.6], 0.35, [6])
        if (dedansPts.length) toits.push(Math.max(...dedansPts))
        // Le pied : la dalle d'une terrasse tracée au pied du mur, sinon le sol.
        const dehors: XY = [px + n[0] * 1, py + n[1] * 1]
        const terrasse = autres.find((o) => o.trace.genre === 'terrasse' && typeof o.mesure.mesure.altitude_relative_sol_m === 'number' && dedans(dehors, enLambert(o.trace, ctx.cadre)))
        lus++
        if (terrasse) {
          surTerrasse++
          const dalle = pointsDans(ctx, enLambert(terrasse.trace, ctx.cadre), 0.1, [2, 6])
          pieds.push(mediane(dalle.map((p) => p[2])))
        } else pieds.push(solEn(ctx.relief, dehors[0], dehors[1]))
      }
      if (!toits.length || !pieds.length) continue
      // L'égout : le toit au droit du mur moins la couverture (25 cm), au-dessus du pied.
      const h = mediane(toits) - 0.25 - mediane(pieds)
      murs.push({ longueur: r2(L), hauteur: r2(h), pied: surTerrasse > lus / 2 ? 'terrasse' : 'sol' })
    }
    const tot = murs.reduce((s, m) => s + m.longueur, 0)
    let gout = NaN
    if (tot > 0) {
      let cumul = 0
      for (const m of [...murs].sort((x, y) => x.hauteur - y.hauteur)) {
        cumul += m.longueur
        if (cumul >= tot / 2) {
          gout = m.hauteur
          break
        }
      }
    }
    if (plan < 10) alertes.push('emprise de moins de 10 m² : est-ce bien la maison ?')
    return base({
      aire_m2: r1(plan),
      perimetre_m: r1(tot),
      gouttiere_m: Number.isNaN(gout) ? null : r2(gout),
      murs: murs.map((m) => `${m.longueur} m × ${m.hauteur} m (pied : ${m.pied})`).join(' ; '),
    })
  }

  if (t.genre === 'escalier') {
    const plan = aire2d(P)
    const pts = pointsDans(ctx, P, 0, [2, 6])
    if (pts.length < 6) return base({ points: pts.length, erreur: 'pas assez de points dans ce tracé' })
    const zs = pts.map((p) => p[2]).sort((a, b) => a - b)
    const bas = mediane(zs.slice(0, Math.max(3, Math.floor(zs.length * 0.2)))), haut = mediane(zs.slice(-Math.max(3, Math.floor(zs.length * 0.2))))
    const denivele = haut - bas
    // La longueur de la volée : l'étendue du tracé le long de sa plus grande dimension.
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1])
    const etendue = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    if (denivele < 0.3) alertes.push('dénivelé de moins de 30 cm : pas un escalier ?')
    return base({ aire_m2: r1(plan), denivele_m: r2(denivele), etendue_m: r1(etendue), marches: Math.max(0, Math.round(denivele / 0.17)), points: pts.length })
  }

  if (t.genre === 'barriere') {
    const pts: [number, number, number][] = []
    const { nuage: nu } = ctx
    for (let i = 0; i < nu.nb; i++) {
      if (nu.classe[i] !== 6 && nu.classe[i] !== 2) continue
      let d = Infinity
      for (let k = 0; k + 1 < P.length; k++) d = Math.min(d, distanceSegment([nu.x[i], nu.y[i]], P[k], P[k + 1]))
      if (d <= 0.3) pts.push([nu.x[i], nu.y[i], nu.z[i]])
    }
    // Ce qui dépasse : les points hauts moins la surface de part et d'autre (à 0,6–1,2 m).
    const autour: number[] = []
    for (let k = 0; k + 1 < P.length; k++) {
      const L = Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1])
      if (L < 0.1) continue
      const n: XY = [-(P[k + 1][1] - P[k][1]) / L, (P[k + 1][0] - P[k][0]) / L]
      for (let s = 0.25; s < L; s += 0.5) {
        for (const cote of [-1, 1]) {
          const x = P[k][0] + ((P[k + 1][0] - P[k][0]) * s) / L + cote * n[0] * 0.9, y = P[k][1] + ((P[k + 1][1] - P[k][1]) * s) / L + cote * n[1] * 0.9
          const proches = pointsAutour(ctx, [x, y], 0.3, [2, 6])
          if (proches.length) autour.push(mediane(proches))
        }
      }
    }
    const haut = pts.length ? mediane(pts.map((p) => p[2]).sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(pts.length * 0.3)))) : NaN
    const ref = mediane(autour)
    if (pts.length < 4) alertes.push("le laser voit peu de points sur ce tracé : une barrière fine n'y est pas toujours")
    return base({ longueur_m: r1(longueurLigne), hauteur_m: Number.isNaN(haut) || Number.isNaN(ref) ? null : r2(Math.max(0, haut - ref)), points: pts.length })
  }

  // mur_soutenement : la différence de niveau entre ses deux côtés.
  {
    const cotes: number[][] = [[], []]
    for (let k = 0; k + 1 < P.length; k++) {
      const L = Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1])
      if (L < 0.1) continue
      const n: XY = [-(P[k + 1][1] - P[k][1]) / L, (P[k + 1][0] - P[k][0]) / L]
      for (let s = 0.25; s < L; s += 0.5) {
        for (const [ci, cote] of [[0, -1], [1, 1]] as const) {
          const x = P[k][0] + ((P[k + 1][0] - P[k][0]) * s) / L + cote * n[0] * 1, y = P[k][1] + ((P[k + 1][1] - P[k][1]) * s) / L + cote * n[1] * 1
          const proches = pointsAutour(ctx, [x, y], 0.3, [2, 6])
          if (proches.length) cotes[ci].push(mediane(proches))
        }
      }
    }
    const a = mediane(cotes[0]), b = mediane(cotes[1])
    if (Number.isNaN(a) || Number.isNaN(b)) alertes.push('pas de sol lu de part et d’autre')
    return base({ longueur_m: r1(longueurLigne), hauteur_m: Number.isNaN(a) || Number.isNaN(b) ? null : r2(Math.abs(a - b)) })
  }
}

function aire2dSigne(P: XY[]): number {
  let s = 0
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/** Les altitudes des points de ces classes à moins de `r` mètres de p. */
function pointsAutour(ctx: Contexte, p: XY, r: number, classes: number[]): number[] {
  const { nuage: nu } = ctx
  const sortie: number[] = []
  for (let i = 0; i < nu.nb; i++) {
    if (!classes.includes(nu.classe[i])) continue
    if (Math.abs(nu.x[i] - p[0]) > r || Math.abs(nu.y[i] - p[1]) > r) continue
    if (Math.hypot(nu.x[i] - p[0], nu.y[i] - p[1]) <= r) sortie.push(nu.z[i])
  }
  return sortie
}

/** Le contrôle des tracés entre eux : ce qui se chevauche, ce qui sort de l'emprise. */
export function verifierTraces(traces: Trace[], cadre: Cadre): string[] {
  const alertes: string[] = []
  const L = new Map(traces.map((t) => [t.id, enLambert(t, cadre)]))
  const emprise = traces.find((t) => t.genre === 'emprise')
  const pans = traces.filter((t) => t.genre === 'pan')
  for (let i = 0; i < pans.length; i++) {
    for (let j = i + 1; j < pans.length; j++) {
      const A = L.get(pans[i].id)!, B = L.get(pans[j].id)!
      // Le chevauchement : la part des sommets de l'un dans l'autre, et le centre.
      const cB: XY = [B.reduce((s, p) => s + p[0], 0) / B.length, B.reduce((s, p) => s + p[1], 0) / B.length]
      const cA: XY = [A.reduce((s, p) => s + p[0], 0) / A.length, A.reduce((s, p) => s + p[1], 0) / A.length]
      if (dedans(cB, A) || dedans(cA, B)) alertes.push(`Les pans ${pans[i].id} et ${pans[j].id} se chevauchent : le centre de l'un est dans l'autre.`)
    }
  }
  if (emprise) {
    const E = L.get(emprise.id)!
    for (const p of pans) {
      const P = L.get(p.id)!
      const dehors = P.filter((q) => !dedans(q, E) && distanceContour(q, E) > 1.2).length
      if (dehors > P.length / 2) alertes.push(`Le pan ${p.id} est en grande partie hors de l'emprise ${emprise.id} : un débord de toit dépasse d'un mètre au plus.`)
    }
  } else if (pans.length) alertes.push("Aucune emprise n'est tracée : trace d'abord le contour des murs de la maison.")
  return alertes
}

/**
 * Ce que les pans tracés ne couvrent pas : les points de toit (à plus de 2 m
 * au-dessus du sol) qui ne tombent dans aucun pan, groupés en morceaux, avec où
 * ils sont sur la photo. Un toit se paye au mètre carré : un pan oublié est une
 * surface perdue.
 */
export function toitNonCouvert(traces: Trace[], ctx: Contexte): { part: number; morceaux: { u: number; v: number; aire: number }[] } {
  const P = traces.filter((t) => t.genre === 'pan').map((t) => enLambert(t, ctx.cadre))
  const emprise = traces.find((t) => t.genre === 'emprise')
  const E = emprise ? enLambert(emprise, ctx.cadre) : null
  const { nuage: nu, relief } = ctx
  const CASE = 0.5
  const nx = Math.ceil((ctx.cadre.bbox[2] - ctx.cadre.bbox[0]) / CASE), ny = Math.ceil((ctx.cadre.bbox[3] - ctx.cadre.bbox[1]) / CASE)
  const toit = new Uint8Array(nx * ny)
  for (let i = 0; i < nu.nb; i++) {
    if (nu.classe[i] !== 6 || nu.z[i] - solEn(relief, nu.x[i], nu.y[i]) < 2) continue
    const cx = Math.floor((nu.x[i] - ctx.cadre.bbox[0]) / CASE), cy = Math.floor((nu.y[i] - ctx.cadre.bbox[1]) / CASE)
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) toit[cy * nx + cx] = 1
  }
  // Seuls comptent les morceaux de toit près de la maison tracée (à 3 m de son emprise), pas le voisin.
  const proche = (p: XY) => !E || dedans(p, E) || distanceContour(p, E) < 3
  let total = 0, couverts = 0
  const libre = new Uint8Array(nx * ny)
  for (let c = 0; c < toit.length; c++) {
    if (!toit[c]) continue
    const cx = c % nx, cy = (c - cx) / nx
    const p: XY = [ctx.cadre.bbox[0] + (cx + 0.5) * CASE, ctx.cadre.bbox[1] + (cy + 0.5) * CASE]
    if (!proche(p)) continue
    total++
    if (P.some((Q) => dedans(p, Q))) couverts++
    else libre[c] = 1
  }
  const vu = new Uint8Array(nx * ny)
  const morceaux: { u: number; v: number; aire: number }[] = []
  for (let c0 = 0; c0 < libre.length; c0++) {
    if (!libre[c0] || vu[c0]) continue
    const cases = [c0]
    vu[c0] = 1
    for (let q = 0; q < cases.length; q++) {
      const c = cases[q], cx = c % nx, cy = (c - cx) / nx
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = cx + dx, Y = cy + dy
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue
        const d = Y * nx + X
        if (libre[d] && !vu[d]) {
          vu[d] = 1
          cases.push(d)
        }
      }
    }
    const aire = cases.length * CASE * CASE * 2
    if (aire < 4) continue
    const mx = cases.reduce((s, c) => s + ((c % nx) + 0.5) * CASE, 0) / cases.length + ctx.cadre.bbox[0]
    const my = cases.reduce((s, c) => s + (Math.floor(c / nx) + 0.5) * CASE, 0) / cases.length + ctx.cadre.bbox[1]
    const [u, v] = versUV([mx, my], ctx.cadre)
    morceaux.push({ u: Math.round(u), v: Math.round(v), aire: Math.round(aire) })
  }
  morceaux.sort((a, b) => b.aire - a.aire)
  return { part: total ? 1 - couverts / total : 0, morceaux: morceaux.slice(0, 4) }
}

/**
 * Les tracés que le PROGRAMME propose à l'IA : le contour des murs, chaque pan
 * lu dans les points, les terrasses. L'IA part de là : elle corrige ce qui est
 * faux au lieu de tout retracer — jamais pire que l'automatique.
 */
export function tracesDepuisReleve(r: Releve, cadre: Cadre): Trace[] {
  const enUV = (c: Point[]): UV[] =>
    c.map(([lon, lat]) => {
      const [x, y] = versLambert93(lon, lat)
      const [u, v] = versUV([x, y], cadre)
      return [Math.min(1000, Math.max(0, Math.round(u))), Math.min(1000, Math.max(0, Math.round(v)))] as UV
    })
  return [
    ...r.pans.map((p): Trace => ({ id: p.id, genre: p.terrasse ? 'terrasse' : 'pan', points: enUV(p.dessin ?? p.contour), note: 'proposé par le programme' })),
    { id: 100, genre: 'emprise', points: enUV(r.murs), note: 'proposé par le programme' },
  ]
}
