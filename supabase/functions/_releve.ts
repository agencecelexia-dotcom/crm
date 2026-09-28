// Le relevé d'une maison dans son nuage de points LiDAR : ce que l'écran
// affiche et ce que le serveur enregistre, calculé en un seul endroit. Sans
// Deno ni réseau : la fonction, l'écran, les tests et le banc lisent ce code.
//
// LES ÉTAPES
//
// 1. Le sol local, puis la hauteur de chaque point au-dessus du sol.
// 2. Le recalage : le contour du cadastre (et ceux des voisins) posé sur le
//    toit relevé (`_recalage.ts`).
// 3. Le débord, côté par côté, puis le contour réel du toit.
// 4. Les pans, lus dans les points ; la surface du toit est leur somme
//    (`_pans.ts`).
// 5. Les façades, côté par côté : la hauteur du toit au droit du mur, moins
//    l'épaisseur de la couverture, au-dessus du sol pris à un mètre dehors.
//
// Tout est calculé en Lambert-93 (mètres) et rendu en longitude, latitude.

import type { Nuage, Zone } from './_copc.ts'
import { depuisLambert93, versLambert93 } from './_calcul-toit.ts'
import { murs as mursDe, type Point } from './_geometrie.ts'
import { Grille2D, solLocal } from './_nuage.ts'
import { lirePans } from './_pans.ts'
import {
  aireL93,
  decaler,
  deplacer,
  distanceAuBord,
  distanceSegment,
  hauteurs,
  masques,
  mesurerBords,
  normaleExterieure,
  recaler,
  type Bord,
  type Pt,
  type Recalage,
} from './_recalage.ts'

/** À changer quand un calcul change : les relevés plus anciens seront refaits. */
export const VERSION_RELEVE = 1

/**
 * Du dessus du toit au dessous de la couverture, au droit du mur : tuiles,
 * liteaux, chevrons, sablière. Le LiDAR voit le dessus ; le façadier peint
 * jusqu'au dessous.
 */
export const EPAISSEUR_COUVERTURE = 0.25

/** Faute de mieux, le débord d'un côté illisible : la médiane des côtés lus. */
const DEBORD_PAR_DEFAUT = 0.4

export interface PanReleve {
  id: number
  pente: number
  orientation: string
  azimut: number
  airePlan: number
  aireVraie: number
  points: number
  /** Écart type des points au plan du pan, en mètres. */
  ecart: number
  partReconstituee: number
  contour: Point[]
}

export interface BordReleve extends Bord {
  /** Le mur (recalé) dont on lit le débord. */
  a: Point
  b: Point
}

export interface FacadeReleve {
  index: number
  orientation: string
  azimut: number
  longueur: number
  a: Point
  b: Point
  /** Arêtes du contour qui composent ce mur. */
  aretes: number[]
  /** Longueur touchée par un autre bâtiment. */
  accole: number
  /** Gouttereau (hauteur constante), pignon (pointe au milieu), ou entre les deux. */
  type: 'gouttereau' | 'pignon' | 'mixte'
  /** Plus basse et plus haute hauteur du mur, en mètres. */
  hauteurBasse: number
  hauteurHaute: number
  /** La silhouette du mur : distance le long du mur, hauteur (tous les 50 cm). */
  profil: [number, number][]
  /** Surface du mur, ouvertures non déduites ; et hors partie accolée. */
  surface: number
  surfaceLibre: number
}

export interface Releve {
  version: number
  /** Fin du vol LiDAR : la maison a pu changer depuis. */
  vol: string | null
  /** `maison_absente` : aucun toit sous le contour (démolie, pas encore bâtie, ou mauvais bâtiment). */
  motif: 'maison_absente' | null
  confiance: 'haute' | 'moyenne' | 'basse'
  raisons: string[]
  points: { total: number; toit: number; densite: number }
  recalage: Recalage
  /** Le contour des murs, recalé. */
  murs: Point[]
  /** Le contour du toit, débord compris. */
  toit: Point[]
  bords: BordReleve[]
  debord: { moyen: number | null; min: number | null; max: number | null; estime: boolean }
  pans: PanReleve[]
  surfaces: { emprise: number; toitPlan: number; toitVrai: number; sansPoints: number }
  facades: FacadeReleve[]
  hauteurs: { faitage: number | null; gouttiere: number | null }
}

export interface EntreeReleve {
  nuage: Nuage
  zone: Zone
  /** Le contour de la maison (BD TOPO), en longitude, latitude. */
  contour: Point[]
  /** Les contours des bâtiments voisins. */
  voisins: Point[][]
  vol: string | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r1 = (v: number) => Math.round(v * 10) / 10
const enDegres = (p: Pt): Point => {
  const [lon, lat] = depuisLambert93(p[0], p[1])
  return [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]
}

export function releverBatiment(e: EntreeReleve): Releve {
  const { nuage: nu, zone } = e
  const sol = solLocal(nu, zone)
  const h = hauteurs(nu, sol)
  const m = masques(nu, h, zone)
  const P = e.contour.map(([lon, lat]) => versLambert93(lon, lat))
  const V = e.voisins.map((c) => c.map(([lon, lat]) => versLambert93(lon, lat)))

  // 1. Recaler.
  const recalage = recaler(m, distanceAuBord(m), P, V)
  const Pr = deplacer(P, recalage.dx, recalage.dy)
  const Vr = V.map((q) => deplacer(q, recalage.dx, recalage.dy))

  // 2. Le débord, côté par côté ; le contour du toit.
  const grille = new Grille2D(nu.x, nu.y, new Uint32Array(nu.nb).map((_, i) => i), 1)
  const bords = mesurerBords(nu, h, grille, Pr, Vr)
  const lus = bords.filter((b) => b.debord !== null && b.etat !== 'accole').map((b) => b.debord!).sort((a, b) => a - b)
  const debordDefaut = lus.length ? lus[Math.floor(lus.length / 2)] : DEBORD_PAR_DEFAUT
  const estime = bords.some((b) => b.debord === null)
  const toit = decaler(Pr, bords.map((b) => b.debord ?? debordDefaut))

  // 3. Les pans.
  const lecture = lirePans(nu, h, toit)
  let pointsToit = 0
  for (const p of lecture.pans) pointsToit += p.points
  const densite = lecture.airePlan ? pointsToit / lecture.airePlan : 0

  // 4. Les façades.
  const facades = facadesDe(Pr, Vr, lecture.pans, toit[0], sol)

  const raisons: string[] = []
  const absente = recalage.motif === 'maison_absente' || !lecture.pans.length
  if (!recalage.fiable) raisons.push(recalage.motif ?? 'recalage_incertain')
  if (estime) raisons.push('debord_estime')
  if (lecture.aireSansPoints > 0.15 * lecture.airePlan) raisons.push('toit_en_partie_cache')
  if (densite < 8) raisons.push('peu_de_points')
  const confiance = absente || !recalage.fiable || densite < 4 ? 'basse' : raisons.length ? 'moyenne' : 'haute'

  const gouttieres = facades.filter((f) => f.type === 'gouttereau').map((f) => f.hauteurBasse).sort((a, b) => a - b)
  const solCentre = sol(
    Pr.reduce((s, p) => s + p[0], 0) / Pr.length,
    Pr.reduce((s, p) => s + p[1], 0) / Pr.length,
  )
  const faitage = lecture.pans.length
    ? Math.max(...lecture.pans.flatMap((p) => p.contour.map(([x, y]) => p.a * (x - toit[0][0]) + p.b * (y - toit[0][1]) + p.c)))
    : null

  return {
    version: VERSION_RELEVE,
    vol: e.vol,
    motif: absente ? 'maison_absente' : null,
    confiance,
    raisons,
    points: { total: nu.nb, toit: pointsToit, densite: r1(densite) },
    recalage,
    murs: Pr.map(enDegres),
    toit: toit.map(enDegres),
    bords: bords.map((b) => ({ ...b, a: enDegres(Pr[b.arete]), b: enDegres(Pr[(b.arete + 1) % Pr.length]) })),
    debord: {
      moyen: lus.length ? r2(lus.reduce((s, v) => s + v, 0) / lus.length) : null,
      min: lus.length ? lus[0] : null,
      max: lus.length ? lus[lus.length - 1] : null,
      estime,
    },
    pans: lecture.pans.map((p) => ({
      id: p.id,
      pente: p.pente,
      orientation: p.orientation,
      azimut: p.azimut,
      airePlan: p.airePlan,
      aireVraie: p.aireVraie,
      points: p.points,
      ecart: p.ecart,
      partReconstituee: p.partReconstituee,
      contour: p.contour.map(enDegres),
    })),
    surfaces: {
      emprise: r1(aireL93(Pr)),
      toitPlan: lecture.airePlan,
      toitVrai: lecture.aireVraie,
      sansPoints: lecture.aireSansPoints,
    },
    facades,
    hauteurs: {
      faitage: faitage === null ? null : r2(faitage - solCentre),
      gouttiere: gouttieres.length ? gouttieres[Math.floor(gouttieres.length / 2)] : null,
    },
  }
}

/**
 * Les façades : pour chaque mur (arêtes presque alignées réunies, comme à
 * l'écran), la hauteur tous les 50 cm — le toit au droit du mur, moins la
 * couverture, au-dessus du sol pris à un mètre dehors.
 */
function facadesDe(
  Pr: Pt[],
  Vr: Pt[][],
  pans: { a: number; b: number; c: number; contour: Pt[] }[],
  origine: Pt,
  sol: (x: number, y: number) => number,
): FacadeReleve[] {
  if (!pans.length) return []
  const enLonLat = Pr.map(enDegres)
  // Le pan au-dessus d'un point : celui dont le contour le contient, sinon le plus proche.
  const toitEn = (p: Pt): number => {
    let meilleur = -1, dMin = Infinity
    for (let k = 0; k < pans.length; k++) {
      const C = pans[k].contour
      let d = Infinity
      if (dedans(p, C)) d = 0
      else for (let i = 0; i < C.length; i++) d = Math.min(d, distanceSegment(p, C[i], C[(i + 1) % C.length]))
      if (d < dMin) [dMin, meilleur] = [d, k]
    }
    const q = pans[meilleur]
    return q.a * (p[0] - origine[0]) + q.b * (p[1] - origine[1]) + q.c
  }
  return mursDe(enLonLat).map((mur) => {
    const profil: [number, number][] = []
    let s0 = 0, accole = 0, surface = 0, surfaceLibre = 0
    for (const i of mur.aretes) {
      const a = Pr[i], b = Pr[(i + 1) % Pr.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = normaleExterieure(Pr, i)
      const k = Math.max(1, Math.round(L / 0.5))
      for (let j = 0; j <= k; j++) {
        if (j === 0 && profil.length) continue
        const t = j / k
        const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        const haut = toitEn(p) - EPAISSEUR_COUVERTURE - sol(p[0] + n[0], p[1] + n[1])
        profil.push([r2(s0 + L * t), r2(Math.max(0, haut))])
      }
      // Surface et partie accolée, par tranches de 50 cm.
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k
        const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        const haut = Math.max(0, toitEn(p) - EPAISSEUR_COUVERTURE - sol(p[0] + n[0], p[1] + n[1]))
        const tranche = L / k
        const touche = Vr.some((Q) => Q.some((q, m) => distanceSegment(p, q, Q[(m + 1) % Q.length]) <= 0.6))
        surface += haut * tranche
        if (touche) accole += tranche
        else surfaceLibre += haut * tranche
      }
      s0 += L
    }
    const hs = profil.map((p) => p[1])
    const bas = Math.min(...hs), haut = Math.max(...hs)
    const iMax = hs.indexOf(haut)
    const auMilieu = iMax > hs.length * 0.15 && iMax < hs.length * 0.85
    return {
      index: mur.index,
      orientation: mur.orientation,
      azimut: Math.round(mur.azimut),
      longueur: r2(mur.longueur),
      a: mur.a,
      b: mur.b,
      aretes: mur.aretes,
      accole: r1(accole),
      type: haut - bas < 0.6 ? 'gouttereau' : haut - bas > 1 && auMilieu ? 'pignon' : 'mixte',
      hauteurBasse: r2(bas),
      hauteurHaute: r2(haut),
      profil,
      surface: r1(surface),
      surfaceLibre: r1(surfaceLibre),
    }
  })
}

function dedans(p: Pt, P: Pt[]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}
