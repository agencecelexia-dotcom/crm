// Quelle photo de rue montre quelle façade ? Sans Deno ni réseau.
//
// Une photo montre un mur si l'appareil est DEVANT lui (du côté extérieur),
// si le mur tombe dans le champ de l'image, et si aucun bâtiment ne se trouve
// entre les deux. Parmi celles-là, on préfère la vue de face (un mur vu de
// biais se lit mal), à bonne distance (entier dans l'image, assez grand), et
// récente. On dit aussi OÙ le mur doit apparaître dans l'image : la vision
// cherchera la façade là, et pas la maison d'à côté.

import { versLambert93 } from './_calcul-toit.ts'
import type { Point } from './_geometrie.ts'
import type { PhotoRue } from './_photos-rue.ts'

type Pt = [number, number]

export interface MurVu {
  orientation: string
  azimut: number
  longueur: number
  a: Point
  b: Point
  /** Surface à traiter (hors mitoyen) : le mur qui pèse le plus choisit la photo. */
  surface: number
}

export interface VueFacade {
  photo: PhotoRue
  /** Note de 0 à 1. */
  note: number
  distance: number
  /** Angle entre la vue et la face du mur (0 = de face), en degrés. */
  incidence: number
  /** Part du mur dans le champ de l'image, et part cachée par un bâtiment. */
  dansLeChamp: number
  cache: number
  /** Où le mur doit apparaître, en abscisse de 0 à 1000 (gauche → droite). */
  colonnes: [number, number]
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
/** Écart signé entre deux caps, dans ]−180, 180]. */
const ecart = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180
/** Le cap (depuis le nord) du vecteur (dx, dy). */
const cap = (dx: number, dy: number) => ((deg(Math.atan2(dx, dy)) % 360) + 360) % 360

/** Le rayon de c à p coupe-t-il le segment [q, r] avant d'arriver ? */
function coupe(c: Pt, p: Pt, q: Pt, r: Pt): boolean {
  const d1x = p[0] - c[0], d1y = p[1] - c[1]
  const d2x = r[0] - q[0], d2y = r[1] - q[1]
  const den = d1x * d2y - d1y * d2x
  if (Math.abs(den) < 1e-12) return false
  const wx = q[0] - c[0], wy = q[1] - c[1]
  const t = (wx * d2y - wy * d2x) / den
  const u = (wx * d1y - wy * d1x) / den
  // Juste avant le mur (t < 0,97) : on ne compte pas le mur lui-même.
  return t > 0.02 && t < 0.97 && u >= 0 && u <= 1
}

/**
 * Les vues d'un mur, de la meilleure à la moins bonne.
 * @param obstacles les contours des autres bâtiments, et celui de la maison.
 */
export function vuesDuMur(mur: MurVu, photos: PhotoRue[], obstacles: Point[][]): VueFacade[] {
  const A = versLambert93(mur.a[0], mur.a[1]), B = versLambert93(mur.b[0], mur.b[1])
  const M: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
  const n: Pt = [Math.sin(rad(mur.azimut)), Math.cos(rad(mur.azimut))]
  const obs = obstacles.map((P) => P.map(([lon, lat]) => versLambert93(lon, lat)))
  const vues: VueFacade[] = []
  for (const photo of photos) {
    const C = versLambert93(photo.lon, photo.lat)
    const v: Pt = [C[0] - M[0], C[1] - M[1]]
    const distance = Math.hypot(v[0], v[1])
    const devant = v[0] * n[0] + v[1] * n[1]
    // Devant le mur, ni collé ni perdu au loin.
    if (devant < 1.5 || distance < 3 || distance > 60) continue
    const incidence = deg(Math.acos(Math.min(1, devant / distance)))
    if (incidence > 70) continue
    const panoramique = photo.champ >= 180
    if (!panoramique && photo.cap === null) continue

    // Le mur dans le champ : cinq visées, de A à B.
    const visees: Pt[] = [0, 0.25, 0.5, 0.75, 1].map((t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t])
    const angles = visees.map((p) => ecart(cap(p[0] - C[0], p[1] - C[1]), photo.cap ?? 0))
    const demi = photo.champ / 2 - 2
    const dansLeChamp = panoramique ? 1 : angles.filter((a) => Math.abs(a) <= demi).length / visees.length
    if (dansLeChamp < 0.4) continue

    // Caché par un bâtiment ?
    const cachees = visees.filter((p) =>
      obs.some((P) => P.some((q, i) => coupe(C, p, q, P[(i + 1) % P.length]))),
    ).length
    const cache = cachees / visees.length
    if (cache > 0.6) continue

    // Les colonnes attendues, de 0 à 1000. La position d'un appareil de rue
    // est connue à quelques mètres, son cap à quelques degrés : à 9 m, quatre
    // mètres d'erreur font 24°. On élargit d'autant la zone annoncée.
    const colonne = (a: number) =>
      panoramique
        ? ((((a + 180) % 360) + 360) % 360) / 360
        : 0.5 + Math.tan(rad(a)) / (2 * Math.tan(rad(Math.min(photo.champ, 170) / 2)))
    const marge = deg(Math.atan(4 / distance)) + 5
    const bornes = [Math.min(...angles) - marge, Math.max(...angles) + marge]
    const cols = [...angles, ...bornes].map((a) => Math.round(1000 * Math.min(1, Math.max(0, colonne(a)))))
    const colonnes: [number, number] = [Math.min(...cols), Math.max(...cols)]

    // La note : de face, bien cadré, dégagé, à bonne distance, récent.
    const proximite = distance < 6 ? distance / 6 : distance <= 25 ? 1 : Math.max(0.2, 1 - (distance - 25) / 40)
    const age = photo.date ? (Date.now() - Date.parse(photo.date)) / (365.25 * 86400e3) : 5
    const fraicheur = Math.max(0.5, 1 - Math.max(0, age) / 10)
    const note = Math.cos(rad(incidence)) * dansLeChamp * (1 - cache) * proximite * fraicheur
    vues.push({
      photo,
      note: Math.round(note * 1000) / 1000,
      distance: Math.round(distance * 10) / 10,
      incidence: Math.round(incidence),
      dansLeChamp: Math.round(dansLeChamp * 100) / 100,
      cache: Math.round(cache * 100) / 100,
      colonnes,
    })
  }
  return vues.sort((x, y) => y.note - x.note)
}

/**
 * Pour chaque orientation, les meilleures vues de son mur principal (le plus
 * grand à traiter). Une orientation toute mitoyenne n'a pas de photo à chercher.
 */
export function vuesDesFacades(
  murs: MurVu[],
  photos: PhotoRue[],
  obstacles: Point[][],
  parOrientation = 3,
): Record<string, VueFacade[]> {
  const principaux = new Map<string, MurVu>()
  for (const m of murs) {
    if (m.surface <= 0) continue
    const p = principaux.get(m.orientation)
    if (!p || m.surface > p.surface) principaux.set(m.orientation, m)
  }
  const sortie: Record<string, VueFacade[]> = {}
  for (const [o, m] of principaux) sortie[o] = vuesDuMur(m, photos, obstacles).slice(0, parOrientation)
  return sortie
}
