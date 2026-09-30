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
import { cardinal, type Point } from './_geometrie.ts'
import type { Niveaux } from './_niveaux.ts'
import { LIBELLES_VOLUME, type SceneIA } from './_scene-ia.ts'
import type { Boite, LectureVision } from './_ouvertures.ts'
import { EPAISSEUR_COUVERTURE, type FacadeReleve, type Releve } from './_releve.ts'

export type Vec3 = [number, number, number]

export interface Face3D {
  type: 'pan' | 'mur' | 'ouverture' | 'marche'
  /** Pan : son numéro ; mur : l'index de sa façade ; ouverture : `façade-rang` ; marche : `e<transition>-<rang>`. */
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
  /**
   * Un mur que le modèle ajoute pour fermer le volume (un décroché du contour,
   * le mur sous un bord de toit, le soutènement d'une terrasse) : il ne compte
   * pas au métré, qui ne le lit pas dans les façades.
   */
  complement?: boolean
  /** Ce que l'IA a reconnu (« Terrasse haute », « Maison »…) : un nom, jamais une mesure. */
  genre?: string
  /** Le volume de la scène de l'IA auquel appartient cette face. */
  volume?: string
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

/** Ce que la lecture par l'IA ajoute au modèle : la scène, et les niveaux du terrain qu'elle nomme. */
export interface LectureIA {
  scene: SceneIA
  niveaux: Pick<Niveaux, 'niveaux' | 'transitions'>
}

export function modeleDuReleve(r: Releve, vues: OuverturesVues[] = [], ia: LectureIA | null = null): Modele3D {
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
      ...genreDuPan(ia, p.id),
    })
  }

  // LES MURS : du sol au dessous du toit, en suivant le profil relevé. Le pied
  // est lissé (le sol se lit par cases d'un mètre) ; le haut, lui, reste au toit.
  const murs = r.murs.map(loc)
  const empreintes: [XY, XY][] = []
  const pieds: Vec3[] = []
  const poser = (
    ref: string,
    chemin: XY[],
    profil: [number, number][],
    sol: number[] | undefined,
    orientation: string,
    porte: Partial<Face3D>,
  ) => {
    const lisse = lisserSol(profil.map((_, i) => sol?.[i] ?? 0))
    const bas: Vec3[] = [], haut: Vec3[] = [], deplieBas: XY[] = [], deplieHaut: XY[] = []
    profil.forEach(([s, h], i) => {
      const [x, y] = pointA(chemin, s)
      const z1 = (sol?.[i] ?? 0) + h
      const z0 = Math.min(lisse[i], z1)
      bas.push([r3(x), r3(y), r3(z0)])
      haut.push([r3(x), r3(y), r3(z1)])
      deplieBas.push([r3(s), r3(z0)])
      deplieHaut.push([r3(s), r3(z1)])
      // Le sol ne se lit qu'au pied des murs du contour, pas sous une terrasse.
      if (!porte.complement || porte.retrait === undefined) pieds.push([x, y, z0])
    })
    for (let i = 0; i + 1 < bas.length; i++) empreintes.push([[bas[i][0], bas[i][1]], [bas[i + 1][0], bas[i + 1][1]]])
    faces.push({
      type: 'mur',
      ref,
      sommets: [...bas, ...haut.reverse()],
      plan2d: [...deplieBas, ...deplieHaut.reverse()],
      surface: 0,
      orientation,
      ...porte,
    })
  }
  for (const f of r.facades) {
    const chemin = cheminDuMur(f, murs, loc)
    if (!chemin) continue
    poser(String(f.index), chemin, f.profil, f.sol, f.orientation, {
      surface: f.surfaceLibre,
      hauteur: [f.hauteurBasse, f.hauteurHaute],
      retrait: f.retrait,
      mitoyen: f.surfaceLibre <= 0 && f.accole > 0,
    })
  }
  // Les décrochés du contour : sans eux, l'anneau des murs a des vides.
  const trigo = aire2d(murs) > 0
  ;(r.decroches ?? []).forEach((d, i) => {
    const a = loc(d.a), b = loc(d.b)
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const [nx, ny] = trigo ? [dy, -dx] : [-dy, dx]
    const hs = d.profil.map((q) => q[1])
    poser(`d${i}`, [a, b], d.profil, d.sol, cardinal(((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360), {
      surface: aireMur(d.profil),
      hauteur: [Math.min(...hs), Math.max(...hs)],
      complement: true,
    })
  })
  // Les bords de toit que nul mur ne porte : un mur sous chacun (murs en retrait
  // au-dessus d'une terrasse, soutènement de la terrasse elle-même).
  const recul = r.debord.moyen ?? 0.4
  const solProche = ([x, y]: XY) => {
    let d = Infinity, z = 0
    for (const q of pieds) {
      const dd = (q[0] - x) ** 2 + (q[1] - y) ** 2
      if (dd < d) [d, z] = [dd, q[2]]
    }
    return z
  }
  const autourDe = (Q: XY[], q: XY) => {
    let d = Infinity
    for (let i = 0; i < Q.length; i++) d = Math.min(d, distanceASegment(q, Q[i], Q[(i + 1) % Q.length]))
    return d
  }
  for (const p of r.pans) {
    const P = nets.get(p.id)!
    const [a, b, c] = p.plan
    const g = Math.hypot(a, b)
    const plan = ([x, y]: XY) => a * x + b * y + c
    const autres = r.pans.filter((q) => q.id !== p.id).map((q) => ({ q, P: nets.get(q.id)! }))
    const sens = aire2d(P) > 0 ? 1 : -1
    for (let i = 0; i < P.length; i++) {
      const u = P[i], v = P[(i + 1) % P.length]
      const L = Math.hypot(v[0] - u[0], v[1] - u[1])
      if (L < 0.5) continue
      const k = Math.ceil(L / 0.25)
      const en = (t: number): XY => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]
      // Un échantillon est « libre » : ni bord partagé avec un autre pan, ni mur à un débord près.
      const n: XY = [(sens * (v[1] - u[1])) / L, (-sens * (v[0] - u[0])) / L]
      // Le mur d'un bord de toit se tient un débord en arrière de lui (le toit déborde du mur).
      const sousLeBord = (q: XY): XY => [q[0] - n[0] * recul, q[1] - n[1] * recul]
      const libre = Array.from({ length: k }, (_, j) => {
        const q = en((j + 0.5) / k)
        return !autres.some(({ P: Q }) => autourDe(Q, q) < 0.4) && !murSous(q, n, empreintes, r.debord.max ?? 0.4)
      })
      const egout = g >= 0.05 && (a * n[0] + b * n[1]) / g <= -0.6
      for (let j0 = 0, run = 0; j0 < k; ) {
        if (!libre[j0]) {
          j0++
          continue
        }
        let j1 = j0
        while (j1 < k && libre[j1]) j1++
        const long = ((j1 - j0) / k) * L
        if (long >= 0.5) {
          const m = Math.max(1, Math.round(long / 0.5))
          const chemin: XY[] = []
          const profil: [number, number][] = [], sol: number[] = []
          let dessous = false, utile = false
          for (let s = 0; s <= m; s++) {
            const q = en((j0 + ((j1 - j0) * s) / m) / k)
            const mur = sousLeBord(q)
            chemin.push(mur)
            const haut = plan(mur) - (egout ? EPAISSEUR_COUVERTURE : 0)
            // Ce qu'on voit au pied : un autre pan (terrasse, toit plus bas), sinon le sol.
            const dehors: XY = [q[0] + n[0] * 0.5, q[1] + n[1] * 0.5]
            const autre = autres.find(({ P: Q }) => dansPolygone2d(dehors, Q))
            const bas = autre ? autre.q.plan[0] * dehors[0] + autre.q.plan[1] * dehors[1] + autre.q.plan[2] : solProche(mur)
            if (autre) dessous = true
            if (haut - bas >= 0.15) utile = true
            profil.push([r3(Math.hypot(mur[0] - chemin[0][0], mur[1] - chemin[0][1])), r3(Math.max(0, haut - bas))])
            sol.push(bas)
          }
          if (utile) {
            const az = ((Math.atan2(n[0], n[1]) * 180) / Math.PI + 360) % 360
            const hs = profil.map((q) => q[1])
            poser(`b${p.id}-${i}-${run}`, chemin, profil, sol, cardinal(az), {
              surface: aireMur(profil),
              hauteur: [Math.min(...hs), Math.max(...hs)],
              complement: true,
              retrait: egout && dessous,
            })
            run++
          }
        }
        j0 = j1
      }
    }
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

  // LES ESCALIERS que l'IA a reconnus entre deux niveaux mesurés : des marches
  // (hauteur d'une marche ≈ 17 cm, giron 30 cm), dont le nombre vient du dénivelé mesuré.
  if (ia) {
    ia.scene.escaliers.forEach((e) => {
      const t = ia.niveaux.transitions[e.transition]
      if (!t) return
      const bas = ia.niveaux.niveaux[t.entre[0]], haut = ia.niveaux.niveaux[t.entre[1]]
      if (!bas || !haut) return
      const n = Math.max(2, Math.round(t.denivele / 0.17))
      const hMarche = t.denivele / n, giron = 0.3
      const large = Math.min(Math.max(t.longueur, 1), 3)
      // Les lectures gardées avant `sens` : du niveau haut vers le bas.
      const [sx, sy] = t.sens ?? ((): XY => {
        const dx = bas.centre[0] - haut.centre[0], dy = bas.centre[1] - haut.centre[1], L = Math.hypot(dx, dy) || 1
        return [dx / L, dy / L]
      })()
      const u: XY = [-sy, sx]
      // Une dalle a son bord AU départ de l'escalier ; une bande de cases, en son milieu.
      const depart = haut.origine === 'dalle' ? 0 : (-n * giron) / 2
      const az = cardinal(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360)
      const pt = (d: number, w: number, z: number): Vec3 => [r3(t.centre[0] + sx * d + u[0] * w), r3(t.centre[1] + sy * d + u[1] * w), r3(z)]
      for (let i = 0; i < n; i++) {
        const z = haut.z - (i + 1) * hMarche
        const d0 = depart + i * giron, d1 = d0 + giron
        faces.push({
          type: 'marche',
          ref: `e${e.transition}-${i}`,
          sommets: [pt(d0, -large / 2, z), pt(d1, -large / 2, z), pt(d1, large / 2, z), pt(d0, large / 2, z)],
          plan2d: [[0, 0], [giron, 0], [giron, large], [0, large]],
          surface: r3(giron * large),
          orientation: az,
          genre: 'Escalier',
          complement: true,
        })
        faces.push({
          type: 'marche',
          ref: `e${e.transition}-${i}h`,
          sommets: [pt(d1, -large / 2, z), pt(d1, large / 2, z), pt(d1, large / 2, z - hMarche), pt(d1, -large / 2, z - hMarche)],
          plan2d: [[0, 0], [large, 0], [large, -hMarche], [0, -hMarche]],
          surface: r3(large * hMarche),
          orientation: az,
          genre: 'Escalier',
          complement: true,
        })
      }
    })
  }

  const tous = faces.flatMap((f) => f.sommets)
  const min: Vec3 = [0, 1, 2].map((k) => Math.min(...tous.map((p) => p[k]))) as Vec3
  const max: Vec3 = [0, 1, 2].map((k) => Math.max(...tous.map((p) => p[k]))) as Vec3
  return { faces, min, max }
}

type XY = [number, number]

/** Ce que l'IA a reconnu pour un pan : le genre de son volume. */
function genreDuPan(ia: LectureIA | null, id: number): { genre?: string; volume?: string } {
  const v = ia?.scene.volumes.find((x) => x.pans.includes(id))
  return v ? { genre: LIBELLES_VOLUME[v.genre], volume: v.ref } : {}
}

/**
 * Le pied d'un mur sans ses marches : médiane glissante sur cinq points, puis
 * pas plus de 30 cm d'un point au suivant. Le sol se lit par cases d'un mètre ;
 * tel quel, le bas des murs se dessine en dents de scie.
 */
function lisserSol(sol: number[]): number[] {
  const n = sol.length
  const lisse = sol.map((_, i) => {
    const w = sol.slice(Math.max(0, i - 2), Math.min(n, i + 3)).sort((x, y) => x - y)
    return w[Math.floor(w.length / 2)]
  })
  const MAX = 0.3
  for (let i = 1; i < n; i++) lisse[i] = Math.min(lisse[i - 1] + MAX, Math.max(lisse[i - 1] - MAX, lisse[i]))
  for (let i = n - 2; i >= 0; i--) lisse[i] = Math.min(lisse[i + 1] + MAX, Math.max(lisse[i + 1] - MAX, lisse[i]))
  return lisse
}

/** La surface d'un mur d'après son profil (distance, hauteur), en trapèzes. */
function aireMur(profil: [number, number][]): number {
  let aire = 0
  for (let i = 0; i + 1 < profil.length; i++) aire += ((profil[i + 1][0] - profil[i][0]) * (profil[i][1] + profil[i + 1][1])) / 2
  return r3(aire)
}

function dansPolygone2d(p: XY, P: XY[]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}

function pansNets(r: Releve, loc: (p: Point) => XY): Map<number, XY[]> {
  const lignes = (r.lignes ?? []).map((l) => ({ pans: l.pans, a: loc(l.a), b: loc(l.b) }))
  return new Map(r.pans.map((p) => [p.id, contourPropre((p.dessin ?? p.contour).map(loc), lignes.filter((l) => l.pans.includes(p.id)))]))
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

/**
 * Le contour d'un pan tel qu'on le dessine : d'abord ramené à un tracé de
 * toit (`alleger` : les dents et les escaliers de cases tombent, l'aire ne
 * bouge que de quelques pour cent), puis calé sur les lignes (`contourNet`).
 * Si le calage abîme le tracé, on garde le tracé allégé.
 */
export function contourPropre(contour: XY[], lignes: { a: XY; b: XY }[]): XY[] {
  const leger = alleger(contour)
  const net = contourNet(leger, lignes)
  const avant = Math.abs(aire2d(leger))
  const bon = net.length >= 3 && net.length <= SOMMETS_PAN_MAX && !seCroise(net) && Math.abs(Math.abs(aire2d(net)) - avant) <= 0.06 * avant + 0.5
  return bon ? net : leger
}

/**
 * Enlève les sommets qui ne portent presque rien (Visvalingam-Whyatt) : celui
 * dont le triangle avec ses deux voisins est le plus petit, tant qu'il en reste
 * plus qu'un tracé de toit n'en demande (`SOMMETS_PAN_MAX`) ou que ce triangle
 * est de moins de 0,25 m². On s'arrête quand l'aire perdue dépasse 5 % (+ 1 m²),
 * et jamais au prix d'un croisement.
 */
export function alleger(contour: XY[]): XY[] {
  let P = contour.slice()
  if (P.length <= 3) return P
  const aire0 = Math.abs(aire2d(P))
  const budget = 0.05 * aire0 + 1
  let perdu = 0
  const triangle = (u: XY, v: XY, w: XY) => Math.abs((v[0] - u[0]) * (w[1] - u[1]) - (w[0] - u[0]) * (v[1] - u[1])) / 2
  for (;;) {
    const n = P.length
    if (n <= 3) break
    const t = P.map((v, i) => triangle(P[(i - 1 + n) % n], v, P[(i + 1) % n]))
    const ordre = t.map((_, i) => i).sort((a, b) => t[a] - t[b])
    if (n <= SOMMETS_PAN_MAX && t[ordre[0]] > 0.25) break
    let retire = -1
    for (const i of ordre) {
      if (perdu + t[i] > budget) break
      const Q = P.filter((_, k) => k !== i)
      if (!seCroise(Q)) {
        retire = i
        break
      }
    }
    if (retire < 0) break
    perdu += t[retire]
    P = P.filter((_, k) => k !== retire)
  }
  return P
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

/**
 * Un mur porte-t-il ce point du bord d'un pan ? Il faut qu'il longe le bord
 * (à 30° près), qu'il soit dessous — au plus un débord et demi en arrière, pas
 * en avant : un mur de l'autre côté du bord ne porte pas le toit — et que le
 * point tombe en face de lui.
 */
function murSous(q: XY, n: XY, empreintes: [XY, XY][], debordMax: number): boolean {
  for (const [e, f] of empreintes) {
    const dx = f[0] - e[0], dy = f[1] - e[1]
    const L = Math.hypot(dx, dy)
    if (L < 1e-6) continue
    // Parallèle au bord : la normale du bord est à angle droit du mur.
    if (Math.abs((dx * n[0] + dy * n[1]) / L) > 0.5) continue
    const t = ((q[0] - e[0]) * dx + (q[1] - e[1]) * dy) / (L * L)
    if (t < -0.02 || t > 1.02) continue
    const w: XY = [e[0] + dx * Math.min(1, Math.max(0, t)), e[1] + dy * Math.min(1, Math.max(0, t))]
    const dehors = (q[0] - w[0]) * n[0] + (q[1] - w[1]) * n[1]
    if (dehors >= -0.3 && dehors <= debordMax + 0.3) return true
  }
  return false
}

/** Un pan de plus de sommets que ça n'est plus un dessin de toit, mais un escalier de cases. */
const SOMMETS_PAN_MAX = 12

/**
 * Les défauts d'un modèle 3D, en clair — vide quand il est propre. C'est le
 * garde-fou des tests (toutes les maisons figées) et du rendu de contrôle :
 * ce que l'audit a vu à l'œil (pans déchirés, murs qui laissent un vide, pied
 * de mur en dents de scie, terrasse qui flotte) devient une vérification.
 */
export function verifierModele(m: Modele3D, r: Releve): string[] {
  const defauts: string[] = []
  const pans = m.faces.filter((f) => f.type === 'pan')
  const murs = m.faces.filter((f) => f.type === 'mur')

  for (const f of pans) {
    const nom = `pan ${f.ref}`
    if (seCroise(f.plan2d)) defauts.push(`${nom} : contour qui se croise`)
    if (f.plan2d.length > SOMMETS_PAN_MAX) defauts.push(`${nom} : ${f.plan2d.length} sommets (> ${SOMMETS_PAN_MAX})`)
    const dessin = aire3d(f.sommets)
    if (f.surface > 1 && Math.abs(dessin - f.surface) > 0.05 * f.surface + 1) {
      defauts.push(`${nom} : dessiné ${dessin.toFixed(1)} m² pour ${f.surface} m² mesurés`)
    }
  }

  // Le pied de chaque mur : pas de dents de scie.
  for (const f of murs) {
    const n = f.sommets.length / 2
    for (let i = 0; i + 1 < n; i++) {
      const saut = Math.abs(f.sommets[i + 1][2] - f.sommets[i][2])
      if (saut > 0.4) {
        defauts.push(`mur ${f.ref} : pied qui saute de ${saut.toFixed(2)} m`)
        break
      }
    }
  }

  // Les murs forment un anneau : chaque bout de mur touche un autre mur.
  const bouts: { p: XY; ref: string }[] = []
  for (const f of murs.filter((x) => !x.retrait && !x.ref.startsWith('b'))) {
    const n = f.sommets.length / 2
    bouts.push({ p: [f.sommets[0][0], f.sommets[0][1]], ref: f.ref }, { p: [f.sommets[n - 1][0], f.sommets[n - 1][1]], ref: f.ref })
  }
  for (const b of bouts) {
    if (!bouts.some((c) => c !== b && c.ref !== b.ref && Math.hypot(c.p[0] - b.p[0], c.p[1] - b.p[1]) < 0.3)) {
      defauts.push(`anneau des murs ouvert au bout du mur ${b.ref} (${b.p[0].toFixed(1)} ; ${b.p[1].toFixed(1)})`)
    }
  }

  // Un bord libre d'un pan (que ne partage aucun autre pan) a un mur sous lui :
  // un débord en arrière du bord, puisque le toit déborde du mur.
  const segments = murs.flatMap((f) => {
    const n = f.sommets.length / 2
    const s: [XY, XY][] = []
    for (let i = 0; i + 1 < n; i++) s.push([[f.sommets[i][0], f.sommets[i][1]], [f.sommets[i + 1][0], f.sommets[i + 1][1]]])
    return s
  })
  for (const f of pans) {
    const autres = pans.filter((g) => g !== f)
    const P = f.plan2d
    const sens = aire2d(P) > 0 ? 1 : -1
    let sansMur = 0, total = 0, premier: XY | null = null
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n: XY = [(sens * (b[1] - a[1])) / L, (-sens * (b[0] - a[0])) / L]
      for (let s = 0.125; s < L; s += 0.25) {
        const q: XY = [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]
        if (autres.some((g) => g.plan2d.some((v, j) => distanceASegment(q, v, g.plan2d[(j + 1) % g.plan2d.length]) < 0.8))) continue
        // Sans mur possible : un pan qui domine un autre pan plus haut que lui (le bord d'une terrasse contre la maison).
        total++
        if (!murSous(q, n, segments, r.debord.max ?? 0.4)) {
          sansMur++
          premier ??= q
        }
      }
    }
    if (total && sansMur / total > 0.2) {
      defauts.push(`pan ${f.ref} : ${Math.round((100 * sansMur) / total)} % de ses bords libres sans mur dessous (dès ${premier![0].toFixed(1)} ; ${premier![1].toFixed(1)})`)
    }
  }
  return defauts
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
