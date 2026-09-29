// Le modèle 3D d'une maison, tiré de son relevé LiDAR (et des photos de ses
// façades) : ce que la vue 3D dessine, ce que le fichier .glb exporte. Sans
// Deno ni réseau, sans bibliothèque 3D : des polygones, que l'écran découpe
// en triangles.
//
// LE REPÈRE : x vers l'est, y vers le nord, z vers le haut, en mètres, depuis
// l'`origine` du relevé (Lambert-93) et son altitude de sol `zSol`.
//
// LES SURFACES : chaque face porte la surface de SON métré (celle du relevé,
// celle qui s'enregistre), pas celle de son dessin — le dessin d'un pan suit
// des cases de 25 cm, le métré est calculé au plus juste.

import { depuisLambert93, versLambert93 } from './_calcul-toit.ts'
import type { Point } from './_geometrie.ts'
import type { Boite, LectureVision } from './_ouvertures.ts'
import type { FacadeReleve, Releve } from './_releve.ts'

export type Vec3 = [number, number, number]

export interface Face3D {
  type: 'pan' | 'mur' | 'ouverture'
  /** Pan : son numéro ; mur : l'index de sa façade ; ouverture : `façade-rang`. */
  ref: string
  sommets: Vec3[]
  /**
   * Le polygone « déplié » dans son propre plan, pour le découper en
   * triangles : (x, y) pour un pan, (distance le long du mur, z) pour un mur.
   */
  plan2d: [number, number][]
  /** Surface du métré (m²). */
  surface: number
  orientation: string
  pente?: number
  hauteur?: [number, number]
  terrasse?: boolean
  retrait?: boolean
  /** Mur entièrement mitoyen : il ne se traite pas. */
  mitoyen?: boolean
  type_ouverture?: string
  /** Ouverture : la photo où elle a été lue, son rang dans la lecture, et si l'artisan l'a retirée. */
  photo?: string
  rang?: number
  ecartee?: boolean
}

export interface Modele3D {
  faces: Face3D[]
  min: Vec3
  max: Vec3
}

/** Les ouvertures lues sur la photo d'une façade. */
export interface OuverturesVues {
  orientation: string
  lecture: Pick<LectureVision, 'cadre' | 'ligne_sol' | 'ligne_gouttiere' | 'ouvertures' | 'meme_maison'>
  photo?: string
  ecartees?: number[]
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

export function modeleDuReleve(r: Releve, vues: OuverturesVues[] = []): Modele3D {
  const [ox, oy] = r.origine
  const loc = ([lon, lat]: Point): [number, number] => {
    const [x, y] = versLambert93(lon, lat)
    return [x - ox, y - oy]
  }
  const faces: Face3D[] = []

  // LES PANS : leur contour, calé sur les lignes du toit, porté à l'altitude de leur plan.
  const nets = pansNets(r, loc)
  for (const p of r.pans) {
    const [a, b, c] = p.plan
    const xy = nets.get(p.id)!
    faces.push({
      type: 'pan',
      ref: String(p.id),
      sommets: xy.map(([x, y]) => [r3(x), r3(y), r3(a * x + b * y + c)]),
      plan2d: xy.map(([x, y]) => [r3(x), r3(y)]),
      surface: p.aireVraie,
      orientation: p.orientation,
      pente: p.pente,
      terrasse: p.terrasse,
    })
  }

  // LES MURS : du sol au dessous du toit, en suivant le profil relevé.
  const murs = r.murs.map(loc)
  for (const f of r.facades) {
    const chemin = cheminDuMur(f, murs, loc)
    if (!chemin) continue
    const bas: Vec3[] = [], haut: Vec3[] = [], deplieBas: [number, number][] = [], deplieHaut: [number, number][] = []
    f.profil.forEach(([s, h], i) => {
      const [x, y] = pointA(chemin, s)
      const z0 = f.sol?.[i] ?? 0
      bas.push([r3(x), r3(y), r3(z0)])
      haut.push([r3(x), r3(y), r3(z0 + h)])
      deplieBas.push([r3(s), r3(z0)])
      deplieHaut.push([r3(s), r3(z0 + h)])
    })
    faces.push({
      type: 'mur',
      ref: String(f.index),
      sommets: [...bas, ...haut.reverse()],
      plan2d: [...deplieBas, ...deplieHaut.reverse()],
      surface: f.surfaceLibre,
      orientation: f.orientation,
      hauteur: [f.hauteurBasse, f.hauteurHaute],
      retrait: f.retrait,
      mitoyen: f.surfaceLibre <= 0 && f.accole > 0,
    })
  }

  // LES OUVERTURES : les boîtes lues sur la photo, posées sur le mur principal
  // de leur orientation, à la place que leur donne le cadre de la façade.
  for (const v of vues) {
    const l = v.lecture
    if (!l.cadre || l.meme_maison === 'non') continue
    const f = r.facades
      .filter((x) => x.orientation === v.orientation && x.surfaceLibre > 0)
      .sort((x, y) => y.surfaceLibre - x.surfaceLibre)[0]
    if (!f) continue
    const chemin = cheminDuMur(f, murs, loc)
    if (!chemin) continue
    const L = f.longueur
    const sol = l.ligne_sol ?? l.cadre.bas
    const gout = l.ligne_gouttiere ?? l.cadre.haut
    const large = l.cadre.droite - l.cadre.gauche
    if (large <= 0 || sol - gout <= 0) continue
    // Qui regarde la façade du dehors voit-il le mur de a vers b ?
    const n: [number, number] = [Math.sin((f.azimut * Math.PI) / 180), Math.cos((f.azimut * Math.PI) / 180)]
    const droite: [number, number] = [-n[1], n[0]]
    const debut = chemin[0], fin = chemin[chemin.length - 1]
    const versB = (fin[0] - debut[0]) * droite[0] + (fin[1] - debut[1]) * droite[1] >= 0
    const sEn = (x: number) => {
      const t = Math.min(1, Math.max(0, (x - l.cadre!.gauche) / large))
      return (versB ? t : 1 - t) * L
    }
    const zEn = (y: number) => Math.max(0, ((sol - y) / (sol - gout)) * f.hauteurBasse)
    l.ouvertures.forEach((o: Boite & { type: string }, i) => {
      const s0 = Math.min(sEn(o.gauche), sEn(o.droite)), s1 = Math.max(sEn(o.gauche), sEn(o.droite))
      const z0 = zEn(o.bas), z1 = zEn(o.haut)
      if (s1 - s0 < 0.2 || z1 - z0 < 0.2) return
      const base = f.sol?.[Math.min(f.sol.length - 1, Math.round((((s0 + s1) / 2) / L) * (f.sol.length - 1)))] ?? 0
      // Trois centimètres devant le mur : l'ouverture se voit sans se confondre avec lui.
      const pose = (s: number, z: number): Vec3 => {
        const [x, y] = pointA(chemin, s)
        return [r3(x + n[0] * 0.03), r3(y + n[1] * 0.03), r3(base + z)]
      }
      faces.push({
        type: 'ouverture',
        ref: `${v.photo ?? f.index}-${i}`,
        sommets: [pose(s0, z0), pose(s1, z0), pose(s1, z1), pose(s0, z1)],
        plan2d: [
          [s0, z0],
          [s1, z0],
          [s1, z1],
          [s0, z1],
        ],
        surface: r3((s1 - s0) * (z1 - z0)),
        orientation: f.orientation,
        type_ouverture: o.type,
        photo: v.photo,
        rang: i,
        ecartee: v.ecartees?.includes(i) || undefined,
      })
    })
  }

  const tous = faces.flatMap((f) => f.sommets)
  const min: Vec3 = [0, 1, 2].map((k) => Math.min(...tous.map((p) => p[k]))) as Vec3
  const max: Vec3 = [0, 1, 2].map((k) => Math.max(...tous.map((p) => p[k]))) as Vec3
  return { faces, min, max }
}

type XY = [number, number]

function pansNets(r: Releve, loc: (p: Point) => XY): Map<number, XY[]> {
  const lignes = (r.lignes ?? []).map((l) => ({ pans: l.pans, a: loc(l.a), b: loc(l.b) }))
  return new Map(r.pans.map((p) => [p.id, contourNet(p.contour.map(loc), lignes.filter((l) => l.pans.includes(p.id)))]))
}

/** Les contours des pans sans leurs marches, en longitude-latitude : ceux que la carte dessine. */
export function contoursDesPans(r: Releve): Map<number, Point[]> {
  const depart = r.pans[0]?.contour[0]
  if (!depart) return new Map()
  const [ox, oy] = r.origine ?? versLambert93(depart[0], depart[1])
  const loc = ([lon, lat]: Point): XY => {
    const [x, y] = versLambert93(lon, lat)
    return [x - ox, y - oy]
  }
  const nets = pansNets(r, loc)
  return new Map([...nets].map(([id, xy]) => [id, xy.map(([x, y]) => depuisLambert93(x + ox, y + oy))]))
}

/** À moins de cette distance d'une ligne du toit, un sommet de pan s'y pose. */
const CALAGE = 0.7

/**
 * Le contour d'un pan, débarrassé de ses marches. Le relevé le trace en cases
 * de 25 cm ; ses lignes (faîtage, arêtiers, noues, égouts, rives) sont, elles,
 * droites, tirées de l'intersection des plans. Chaque sommet proche d'une
 * ligne du pan s'y pose (sur son bout s'il en est près) ; les sommets alignés
 * tombent. Deux pans voisins se calent sur la même ligne : pas de jour entre
 * eux. Si le résultat s'écarte trop du contour d'origine, on garde celui-ci.
 */
export function contourNet(contour: XY[], lignes: { a: XY; b: XY }[]): XY[] {
  if (!lignes.length || contour.length < 4) return contour
  const bouts = lignes.flatMap((l) => [l.a, l.b])
  const cale = contour.map((v): XY => {
    let mieux: XY = v, dMieux = CALAGE
    for (const q of bouts) {
      const d = Math.hypot(q[0] - v[0], q[1] - v[1])
      if (d < dMieux) {
        mieux = q
        dMieux = d
      }
    }
    if (mieux !== v) return mieux
    for (const l of lignes) {
      const q = projete(v, l.a, l.b)
      const d = Math.hypot(q[0] - v[0], q[1] - v[1])
      if (d < dMieux) {
        mieux = q
        dMieux = d
      }
    }
    return mieux
  })
  // Les doublons, puis les sommets alignés, tombent.
  let net = cale.filter((v, i) => {
    const w = cale[(i + 1) % cale.length]
    return Math.hypot(w[0] - v[0], w[1] - v[1]) > 0.05
  })
  for (let change = true; change && net.length > 3; ) {
    change = false
    for (let i = 0; i < net.length && net.length > 3; i++) {
      const u = net[(i - 1 + net.length) % net.length], v = net[i], w = net[(i + 1) % net.length]
      if (distanceASegment(v, u, w) < 0.08) {
        net = net.filter((_, k) => k !== i)
        change = true
      }
    }
  }
  const avant = Math.abs(aire2d(contour)), apres = Math.abs(aire2d(net))
  if (net.length < 3 || Math.abs(apres - avant) > 0.06 * avant + 0.5 || seCroise(net)) return contour
  return net
}

function projete(v: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2)) : 0
  return [a[0] + dx * t, a[1] + dy * t]
}

function distanceASegment(v: XY, a: XY, b: XY): number {
  const q = projete(v, a, b)
  return Math.hypot(q[0] - v[0], q[1] - v[1])
}

function aire2d(P: XY[]): number {
  let s = 0
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/** Deux côtés non voisins du polygone se croisent-ils ? */
function seCroise(P: XY[]): boolean {
  const n = P.length
  const orient = (a: XY, b: XY, c: XY) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n]
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true
    }
  }
  return false
}

/** Le tracé d'un mur en plan : ses arêtes du contour, ou sa ligne s'il est en retrait. */
function cheminDuMur(f: FacadeReleve, murs: [number, number][], loc: (p: Point) => [number, number]): [number, number][] | null {
  if (!f.profil.length) return null
  if (!f.aretes.length) return [loc(f.a), loc(f.b)]
  const pts: [number, number][] = [murs[f.aretes[0]]]
  for (const i of f.aretes) pts.push(murs[(i + 1) % murs.length])
  return pts
}

/** Le point à la distance `s` le long d'une ligne brisée. */
function pointA(chemin: [number, number][], s: number): [number, number] {
  let reste = s
  for (let i = 0; i + 1 < chemin.length; i++) {
    const a = chemin[i], b = chemin[i + 1]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (reste <= L || i + 2 === chemin.length) {
      const t = L > 0 ? Math.min(1, Math.max(0, reste / L)) : 0
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    reste -= L
  }
  return chemin[chemin.length - 1]
}

/** L'aire d'un polygone 3D plan (formule de Newell). */
export function aire3d(P: Vec3[]): number {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < P.length; i++) {
    const [x1, y1, z1] = P[i], [x2, y2, z2] = P[(i + 1) % P.length]
    nx += (y1 - y2) * (z1 + z2)
    ny += (z1 - z2) * (x1 + x2)
    nz += (x1 - x2) * (y1 + y2)
  }
  return Math.hypot(nx, ny, nz) / 2
}
