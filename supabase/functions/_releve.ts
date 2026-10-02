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
import { cardinal, murs as mursDe, type Point } from './_geometrie.ts'
import { Grille2D, solLocal } from './_nuage.ts'
import { lirePans, type PanImpose, type TypeLigne } from './_pans.ts'
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

/**
 * À changer quand un calcul change : les relevés plus anciens seront refaits.
 * 2 : tronçons mitoyens et côté rue de chaque façade.
 * 3 : un côté illisible ne rabaisse la confiance que s'il pèse.
 * 4 : les lignes du toit (faîtage, arêtiers, noues, égouts, rives) ; ce
 *     qui n'est pas toit (terrasse) sort du compte.
 * 5 : de quoi dessiner la maison en 3D (plan de chaque pan, sol le long des
 *     murs) ; les murs en retrait derrière une terrasse.
 * 6 : la hauteur à la gouttière est lue là où un pan descend vers le mur, à
 *     la longueur (plus la médiane des murs) et existe sur tout toit ; les
 *     décrochés du contour ont leur profil (`decroches`), pour un anneau de
 *     murs fermé en 3D.
 * 7 : la justesse des pans (`qualitePlans`) et leur origine (`pansDe`) : de quoi
 *     retenir les pans corrigés par l'IA seulement s'ils expliquent mieux le laser.
 */
export const VERSION_RELEVE = 7

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
  /** Le contour à dessiner (étiquettes lissées) ; `contour` est celui des calculs. */
  dessin?: Point[]
  /**
   * Une partie plate nettement plus basse que les égouts du toit : une
   * terrasse, un toit de garage. Elle n'est pas comptée par défaut.
   */
  terrasse: boolean
  /**
   * Le plan du pan : z = a·x + b·y + c, en mètres, x et y depuis l'`origine`
   * du relevé (Lambert-93), z depuis son `zSol`.
   */
  plan: [number, number, number]
}

export type { TypeLigne } from './_pans.ts'

/** Une ligne du toit : ce que le couvreur chiffre au mètre. */
export interface LigneReleve {
  type: TypeLigne
  /** Longueur vraie, pente comprise (m). */
  longueur: number
  a: Point
  b: Point
  /** Les pans qu'elle borde : écarter tous ses pans l'écarte. */
  pans: number[]
  /** Un bord à l'intérieur du contour, au-dessus d'une terrasse ou d'un toit plus bas. */
  interieur?: boolean
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
  /** Longueur touchée par un autre bâtiment, et où (de, à — en mètres le long du mur). */
  accole: number
  mitoyen: [number, number][]
  /**
   * Distance du mur à la route qu'il regarde, sans bâtiment entre les deux
   * (m) ; null s'il n'en voit aucune à moins de 40 m.
   */
  distanceRue: number | null
  /** Le côté rue : la façade la plus proche d'une route vue (et celles à 3 m près d'elle). */
  rue: boolean
  /** Gouttereau (hauteur constante), pignon (pointe au milieu), ou entre les deux. */
  type: 'gouttereau' | 'pignon' | 'mixte'
  /** Plus basse et plus haute hauteur du mur, en mètres. */
  hauteurBasse: number
  hauteurHaute: number
  /** La silhouette du mur : distance le long du mur, hauteur (tous les 50 cm). */
  profil: [number, number][]
  /** L'altitude du sol au pied de chaque point du profil, depuis le `zSol` du relevé. */
  sol: number[]
  /**
   * Un mur EN RETRAIT : sous l'égout d'un pan qui domine une terrasse ou un
   * toit plus bas, là où le contour du cadastre ne passe pas.
   */
  retrait?: boolean
  /** Surface du mur, ouvertures non déduites ; et hors partie accolée. */
  surface: number
  surfaceLibre: number
}

export interface Releve {
  version: number
  /** Le repère du modèle 3D : un point en Lambert-93, et l'altitude du sol (IGN69) au centre de la maison. */
  origine: [number, number]
  zSol: number
  /**
   * L'IGN a-t-il sa photo très fine (5 à 10 cm) sur cette maison ? Posé par
   * la lecture à l'IGN (une tuile essayée) ; absent sur les relevés anciens.
   */
  ortho5cm?: boolean
  /** Fin du vol LiDAR : la maison a pu changer depuis. */
  vol: string | null
  /** `maison_absente` : aucun toit sous le contour (démolie, pas encore bâtie, ou mauvais bâtiment). */
  motif: 'maison_absente' | null
  confiance: 'haute' | 'moyenne' | 'basse'
  raisons: string[]
  points: { total: number; toit: number; densite: number }
  recalage: Recalage
  /**
   * D'où viennent les pans : lus par l'algorithme (`auto`) ou tracés par l'IA
   * ou l'artisan (`trace`). Absent sur les relevés anciens (= auto).
   */
  pansDe?: 'auto' | 'trace'
  /** La part des points de toit que les pans expliquent à 12 cm près (1 = tout) : la justesse de la segmentation. */
  qualitePlans?: number
  /** Le contour des murs, recalé. */
  murs: Point[]
  /** Le contour du toit, débord compris. */
  toit: Point[]
  bords: BordReleve[]
  debord: { moyen: number | null; min: number | null; max: number | null; estime: boolean }
  pans: PanReleve[]
  lignes: LigneReleve[]
  surfaces: { emprise: number; toitPlan: number; toitVrai: number; sansPoints: number }
  facades: FacadeReleve[]
  /**
   * Les côtés du contour trop courts pour être une façade (moins d'un mètre,
   * ou pris dans un mur voisin d'une autre direction) : ils ne comptent pas
   * au métré, mais le modèle 3D les dessine, pour que les murs se referment.
   */
  decroches?: MurDecroche[]
  /**
   * Faîtage : au-dessus du sol au centre de la maison. Gouttière : au-dessus
   * du sol au pied du mur, jusqu'au dessous de la couverture, lue là où un pan
   * descend vers le mur (`gouttiereMin`/`gouttiereMax` : l'éventail, quand le
   * terrain est en pente).
   */
  hauteurs: { faitage: number | null; gouttiere: number | null; gouttiereMin?: number | null; gouttiereMax?: number | null }
}

export interface MurDecroche {
  a: Point
  b: Point
  longueur: number
  /** Comme pour une façade : distance le long du mur, hauteur ; et sol au pied de chaque point. */
  profil: [number, number][]
  sol: number[]
}

export interface EntreeReleve {
  nuage: Nuage
  zone: Zone
  /** Le contour de la maison (BD TOPO), en longitude, latitude. */
  contour: Point[]
  /** Les contours des bâtiments voisins. */
  voisins: Point[][]
  /** Les routes alentour (BD TOPO), pour dire quel côté donne sur la rue. */
  routes?: Point[][]
  vol: string | null
  /**
   * Les pans TRACÉS (par l'IA ou l'artisan), en Lambert-93 : ils remplacent la
   * segmentation automatique du toit. Les points qu'aucun tracé ne contient
   * rejoignent le pan dont ils suivent le plan : un pan trop petit ne perd pas
   * de surface.
   */
  imposes?: PanImpose[]
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
  // Un côté illisible ne compte que s'il pèse : plus d'un cinquième du tour
  // libre (hors mitoyens et hors décrochés de moins d'un mètre).
  const libres = bords.filter((b) => b.etat !== 'accole' && b.longueur >= 1)
  const tourLibre = libres.reduce((s, b) => s + b.longueur, 0)
  const illisible = libres.filter((b) => b.debord === null).reduce((s, b) => s + b.longueur, 0)
  const toit = decaler(Pr, bords.map((b) => b.debord ?? debordDefaut))

  // 3. Les pans.
  const lecture = lirePans(
    nu,
    h,
    toit,
    bords.map((b) => b.etat === 'accole'),
    e.imposes ?? [],
  )
  let pointsToit = 0
  for (const p of lecture.pans) pointsToit += p.points
  const densite = lecture.airePlan ? pointsToit / lecture.airePlan : 0

  // 4. Les façades.
  const routes = (e.routes ?? []).map((l) => l.map(([lon, lat]) => versLambert93(lon, lat)))
  const solCentre = sol(
    Pr.reduce((s, p) => s + p[0], 0) / Pr.length,
    Pr.reduce((s, p) => s + p[1], 0) / Pr.length,
  )
  const { facades, egouts, decroches } = facadesDe(Pr, Vr, lecture.pans, toit[0], sol, routes, solCentre)

  // LES TERRASSES. Une partie plate plus basse d'un mètre que l'égout le plus
  // bas des pans en pente n'est pas la toiture qu'on couvre : c'est une
  // terrasse, un toit de garage. Elle reste visible, mais hors du compte.
  const hauteurEn = (p: { a: number; b: number; c: number }, [x, y]: Pt) =>
    p.a * (x - toit[0][0]) + p.b * (y - toit[0][1]) + p.c - sol(x, y)
  const penches = lecture.pans.filter((p) => p.orientation !== 'plat')
  const egoutBas = penches.length
    ? Math.min(...penches.map((p) => Math.min(...p.contour.map((q) => hauteurEn(p, q)))))
    : null
  const estTerrasse = (p: (typeof lecture.pans)[number]) => {
    if (p.orientation !== 'plat' || egoutBas === null) return false
    const cx = p.contour.reduce((s, q) => s + q[0], 0) / p.contour.length
    const cy = p.contour.reduce((s, q) => s + q[1], 0) / p.contour.length
    return hauteurEn(p, [cx, cy]) < egoutBas - 1
  }

  const raisons: string[] = []
  const absente = recalage.motif === 'maison_absente' || !lecture.pans.length
  if (!recalage.fiable) raisons.push(recalage.motif ?? 'recalage_incertain')
  if (tourLibre > 0 && illisible / tourLibre > 0.2) raisons.push('debord_estime')
  if (lecture.aireSansPoints > 0.15 * lecture.airePlan) raisons.push('toit_en_partie_cache')
  if (densite < 8) raisons.push('peu_de_points')
  const confiance = absente || !recalage.fiable || densite < 4 ? 'basse' : raisons.length ? 'moyenne' : 'haute'

  // LES MURS EN RETRAIT. Sous l'égout d'un pan qui domine une terrasse (ou un
  // toit plus bas) se tient le vrai mur de la maison, que le contour du
  // cadastre ne suit pas : on le place à un débord en arrière de l'égout.
  for (const l of lecture.lignes) {
    if (!l.interieur || l.type !== 'egout' || l.bas === undefined) continue
    const p = lecture.pans.find((q) => q.id === l.pans[0])
    if (!p) continue
    const g = Math.hypot(p.a, p.b)
    if (g < 0.05) continue
    // En arrière de l'égout : vers le haut du pan.
    const recul: Pt = [(p.a / g) * debordDefaut, (p.b / g) * debordDefaut]
    const A: Pt = [l.a[0] + recul[0], l.a[1] + recul[1]], B: Pt = [l.b[0] + recul[0], l.b[1] + recul[1]]
    const L = Math.hypot(B[0] - A[0], B[1] - A[1])
    if (L < 1) continue
    const k = Math.max(1, Math.round(L / 0.5))
    const profil: [number, number][] = []
    const solMur: number[] = []
    for (let j = 0; j <= k; j++) {
      const t = j / k
      const q: Pt = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]
      const haut = p.a * (q[0] - toit[0][0]) + p.b * (q[1] - toit[0][1]) + p.c - EPAISSEUR_COUVERTURE - l.bas
      profil.push([r2(L * t), r2(Math.max(0, haut))])
      solMur.push(r2(l.bas - solCentre))
    }
    const hs = profil.map((x) => x[1])
    const surface = hs.slice(1).reduce((s, v, j) => s + ((v + hs[j]) / 2) * (L / k), 0)
    if (surface < 1) continue
    const azimut = ((((Math.atan2(-p.a, -p.b) * 180) / Math.PI) % 360) + 360) % 360
    facades.push({
      index: facades.length,
      orientation: cardinal(azimut),
      azimut: Math.round(azimut),
      longueur: r2(L),
      a: enDegres(A),
      b: enDegres(B),
      aretes: [],
      accole: 0,
      mitoyen: [],
      distanceRue: null,
      rue: false,
      type: 'gouttereau',
      hauteurBasse: r2(Math.min(...hs)),
      hauteurHaute: r2(Math.max(...hs)),
      profil,
      sol: solMur,
      surface: r1(surface),
      surfaceLibre: r1(surface),
      retrait: true,
    })
  }

  const gouttiere = hauteurGouttiere(egouts, facades)
  const faitage = lecture.pans.length
    ? Math.max(...lecture.pans.flatMap((p) => p.contour.map(([x, y]) => p.a * (x - toit[0][0]) + p.b * (y - toit[0][1]) + p.c)))
    : null

  return {
    version: VERSION_RELEVE,
    pansDe: (e.imposes?.length ? 'trace' : 'auto') as 'auto' | 'trace',
    qualitePlans: lecture.explique,
    origine: [r2(toit[0][0]), r2(toit[0][1])],
    zSol: r2(solCentre),
    vol: e.vol,
    motif: absente ? 'maison_absente' : null,
    confiance,
    raisons,
    points: { total: nu.nb, toit: pointsToit, densite: r1(densite) },
    recalage,
    murs: Pr.map(enDegres),
    // Le bord du toit : le contour décalé du débord, sauf quand une part du
    // contour du cadastre n'est pas du toit (terrasse, cour) — alors le tour
    // des pans relevés.
    toit: (lecture.aireHorsToit > 2 && lecture.contourToit.length >= 3 ? lecture.contourToit : toit).map(enDegres),
    bords: bords.map((b) => ({ ...b, a: enDegres(Pr[b.arete]), b: enDegres(Pr[(b.arete + 1) % Pr.length]) })),
    debord: {
      moyen: lus.length ? r2(lus.reduce((s, v) => s + v, 0) / lus.length) : null,
      min: lus.length ? lus[0] : null,
      max: lus.length ? lus[lus.length - 1] : null,
      estime,
    },
    lignes: lecture.lignes.map((l) => ({
      type: l.type,
      longueur: Math.round(l.longueur * 100) / 100,
      a: enDegres(l.a),
      b: enDegres(l.b),
      pans: l.pans,
      ...(l.interieur ? { interieur: true } : {}),
    })),
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
      // Un pan tracé comme terrasse (ou comme toit) l'est ; sinon, la règle des égouts.
      terrasse: p.terrasseImposee ?? estTerrasse(p),
      // L'origine du relevé est le premier sommet du contour du toit, arrondi
      // au centimètre : le plan est ramené à ce point arrondi.
      plan: [
        Math.round(p.a * 1e5) / 1e5,
        Math.round(p.b * 1e5) / 1e5,
        Math.round((p.c + p.a * (r2(toit[0][0]) - toit[0][0]) + p.b * (r2(toit[0][1]) - toit[0][1]) - r2(solCentre)) * 1000) / 1000,
      ] as [number, number, number],
      contour: p.contour.map(enDegres),
      dessin: p.dessin.map(enDegres),
    })),
    surfaces: {
      emprise: r1(aireL93(Pr)),
      toitPlan: lecture.airePlan,
      toitVrai: lecture.aireVraie,
      sansPoints: lecture.aireSansPoints,
    },
    facades,
    decroches,
    hauteurs: {
      faitage: faitage === null ? null : r2(faitage - solCentre),
      gouttiere: gouttiere?.mediane ?? null,
      gouttiereMin: gouttiere?.min ?? null,
      gouttiereMax: gouttiere?.max ?? null,
    },
  }
}

/**
 * La hauteur à la gouttière : la médiane, PONDÉRÉE PAR LA LONGUEUR, des hauteurs
 * mesurées là où un pan descend vers un mur libre. Les quartiles bas et haut
 * disent l'éventail (le terrain en pente le fait varier d'un mur à l'autre).
 * Une annexe basse ou un petit décroché ne pèsent que leur longueur ; sans
 * aucun égout lu (un toit tout plat), la médiane des murs à la longueur.
 */
export function hauteurGouttiere(
  egouts: { h: number; l: number }[],
  facades: { retrait?: boolean; surfaceLibre: number; hauteurBasse: number; longueur: number }[],
): { mediane: number; min: number; max: number } | null {
  let lus = egouts
  if (!lus.length) {
    lus = facades.filter((f) => !f.retrait && f.surfaceLibre > 0 && f.longueur > 0).map((f) => ({ h: f.hauteurBasse, l: f.longueur }))
  }
  if (!lus.length) return null
  const tries = [...lus].sort((a, b) => a.h - b.h)
  const total = tries.reduce((s, x) => s + x.l, 0)
  const quantile = (q: number) => {
    let cumul = 0
    for (const x of tries) {
      cumul += x.l
      if (cumul >= total * q) return x.h
    }
    return tries[tries.length - 1].h
  }
  return { mediane: r2(quantile(0.5)), min: r2(quantile(0.1)), max: r2(quantile(0.9)) }
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
  routes: Pt[][],
  zSol: number,
): { facades: FacadeReleve[]; egouts: { h: number; l: number }[]; decroches: MurDecroche[] } {
  if (!pans.length) return { facades: [], egouts: [], decroches: [] }
  const enLonLat = Pr.map(enDegres)
  // Le pan au-dessus d'un point : celui dont le contour le contient, sinon le plus proche.
  const panEn = (p: Pt): number => {
    let meilleur = -1, dMin = Infinity
    for (let k = 0; k < pans.length; k++) {
      const C = pans[k].contour
      let d = Infinity
      if (dedans(p, C)) d = 0
      else for (let i = 0; i < C.length; i++) d = Math.min(d, distanceSegment(p, C[i], C[(i + 1) % C.length]))
      if (d < dMin) [dMin, meilleur] = [d, k]
    }
    return meilleur
  }
  const toitEn = (p: Pt): number => {
    const q = pans[panEn(p)]
    return q.a * (p[0] - origine[0]) + q.b * (p[1] - origine[1]) + q.c
  }
  // Sous un égout : le pan au-dessus du mur DESCEND vers lui (au moins 60 % de
  // sa pente, et 5 % au moins). Un pignon, où le pan longe le mur, n'en est pas un.
  const sousUnEgout = (p: Pt, n: Pt): boolean => {
    const q = pans[panEn(p)]
    const pente = Math.hypot(q.a, q.b)
    return pente >= 0.05 && -(q.a * n[0] + q.b * n[1]) / pente >= 0.6
  }
  const egouts: { h: number; l: number }[] = []
  const facades = mursDe(enLonLat).map((mur): FacadeReleve => {
    const profil: [number, number][] = []
    const solMur: number[] = []
    const mitoyen: [number, number][] = []
    let distanceRue: number | null = null
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
        const pied = sol(p[0] + n[0], p[1] + n[1])
        const haut = toitEn(p) - EPAISSEUR_COUVERTURE - pied
        profil.push([r2(s0 + L * t), r2(Math.max(0, haut))])
        solMur.push(r2(pied - zSol))
      }
      // Surface et partie accolée, par tranches de 50 cm : chaque tranche est
      // le trapèze entre deux points du profil, celui que la vue 3D dessine —
      // le dessin et le métré ne peuvent pas diverger.
      const hauteurEn = (t: number) => {
        const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        return Math.max(0, toitEn(q) - EPAISSEUR_COUVERTURE - sol(q[0] + n[0], q[1] + n[1]))
      }
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k
        const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        const haut = (hauteurEn(j / k) + hauteurEn((j + 1) / k)) / 2
        const tranche = L / k
        const touche = Vr.some((Q) => Q.some((q, m) => distanceSegment(p, q, Q[(m + 1) % Q.length]) <= 0.6))
        surface += haut * tranche
        if (!touche && sousUnEgout(p, n)) egouts.push({ h: haut, l: tranche })
        if (touche) {
          accole += tranche
          const de = r2(s0 + j * tranche), a = r2(s0 + (j + 1) * tranche)
          const dernier = mitoyen[mitoyen.length - 1]
          if (dernier && Math.abs(dernier[1] - de) < 0.01) dernier[1] = a
          else mitoyen.push([de, a])
        } else surfaceLibre += haut * tranche
      }
      const d = versLaRue(a, b, n, routes, Vr)
      if (d !== null && (distanceRue === null || d < distanceRue)) distanceRue = d
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
      mitoyen,
      distanceRue: distanceRue === null ? null : r1(distanceRue),
      rue: false,
      type: haut - bas < 0.6 ? 'gouttereau' : haut - bas > 1 && auMilieu ? 'pignon' : 'mixte',
      hauteurBasse: r2(bas),
      hauteurHaute: r2(haut),
      profil,
      sol: solMur,
      surface: r1(surface),
      surfaceLibre: r1(surfaceLibre),
    }
  })
  // Le côté rue : la façade la plus proche d'une route qu'elle voit, et celles
  // qui en sont à trois mètres près (une maison d'angle en a deux).
  const vues = facades.map((f) => f.distanceRue).filter((d): d is number => d !== null)
  if (vues.length) {
    const d0 = Math.min(...vues)
    for (const f of facades) f.rue = f.distanceRue !== null && f.distanceRue <= Math.min(d0 + 3, 30)
  }

  // Les côtés du contour que nulle façade ne porte : leur profil, pour que le
  // modèle 3D ferme l'anneau des murs.
  const portes = new Set(facades.flatMap((f) => f.aretes))
  const decroches: MurDecroche[] = []
  for (let i = 0; i < Pr.length; i++) {
    if (portes.has(i)) continue
    const a = Pr[i], b = Pr[(i + 1) % Pr.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.05) continue
    const n = normaleExterieure(Pr, i)
    const k = Math.max(1, Math.round(L / 0.5))
    const profil: [number, number][] = []
    const solMur: number[] = []
    for (let j = 0; j <= k; j++) {
      const t = j / k
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const pied = sol(p[0] + n[0], p[1] + n[1])
      profil.push([r2(L * t), r2(Math.max(0, toitEn(p) - EPAISSEUR_COUVERTURE - pied))])
      solMur.push(r2(pied - zSol))
    }
    decroches.push({ a: enLonLat[i], b: enLonLat[(i + 1) % Pr.length], longueur: r2(L), profil, sol: solMur })
  }
  return { facades, egouts, decroches }
}

/** Jusqu'où l'on cherche la rue devant un mur. */
const PORTEE_RUE = 40

/**
 * La distance du mur à la première route croisée en le regardant de face
 * (cinq visées le long du mur), si aucun bâtiment ne la cache.
 */
function versLaRue(a: Pt, b: Pt, n: Pt, routes: Pt[][], obstacles: Pt[][]): number | null {
  if (!routes.length) return null
  let meilleure: number | null = null
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const o: Pt = [a[0] + (b[0] - a[0]) * t + n[0] * 0.3, a[1] + (b[1] - a[1]) * t + n[1] * 0.3]
    let route = Infinity
    for (const l of routes) for (let i = 0; i + 1 < l.length; i++) route = Math.min(route, rayon(o, n, l[i], l[i + 1]))
    if (route > PORTEE_RUE) continue
    let obstacle = Infinity
    for (const Q of obstacles) for (let i = 0; i < Q.length; i++) obstacle = Math.min(obstacle, rayon(o, n, Q[i], Q[(i + 1) % Q.length]))
    if (obstacle < route) continue
    const d = route + 0.3
    if (meilleure === null || d < meilleure) meilleure = d
  }
  return meilleure
}

/** Distance, le long du rayon (o, n), jusqu'au segment [p, q] ; Infinity s'il ne le croise pas. */
function rayon(o: Pt, n: Pt, p: Pt, q: Pt): number {
  const ex = q[0] - p[0], ey = q[1] - p[1]
  const den = n[0] * ey - n[1] * ex
  if (Math.abs(den) < 1e-12) return Infinity
  const wx = p[0] - o[0], wy = p[1] - o[1]
  const t = (wx * ey - wy * ex) / den
  const u = (wx * n[1] - wy * n[0]) / den
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity
}

function dedans(p: Pt, P: Pt[]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}
