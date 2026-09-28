import { murs, type Point } from './geometrie'

/**
 * La géométrie d'un croquis coté : le contour d'une maison ramené en mètres,
 * nord en haut, avec la longueur de chaque mur placée à l'extérieur.
 *
 * C'est la page que donnent tous les rapports de métré du marché : un dessin
 * qu'on lit d'un coup d'œil, où chaque côté porte sa cote. Séparée du rendu
 * pour être vérifiable.
 */
export interface Cote {
  /** Orientation du mur, pour le relier à sa façade. */
  orientation: string
  longueur: number
  /** Extrémités du mur, dans le repère du dessin. */
  a: [number, number]
  b: [number, number]
  /** Où écrire la cote : au milieu du mur, décalé vers l'extérieur. */
  etiquette: [number, number]
}

export interface GeometrieCroquis {
  largeur: number
  hauteur: number
  contour: [number, number][]
  cotes: Cote[]
}

const R = 6378137
const rad = (d: number) => (d * Math.PI) / 180

/**
 * @param largeur largeur du dessin, en pixels ; la hauteur suit les proportions.
 * @param marge place laissée autour pour les cotes.
 */
export function geometrieCroquis(contour: Point[], largeur = 320, marge = 34): GeometrieCroquis | null {
  if (!contour || contour.length < 3) return null
  const lat0 = contour.reduce((s, p) => s + p[1], 0) / contour.length
  const lon0 = contour.reduce((s, p) => s + p[0], 0) / contour.length
  // En mètres, est vers la droite, nord vers le HAUT (y du dessin inversé).
  const enM = (p: Point): [number, number] => [
    rad(p[0] - lon0) * R * Math.cos(rad(lat0)),
    -rad(p[1] - lat0) * R,
  ]
  const pts = contour.map(enM)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  const echelle = (largeur - 2 * marge) / Math.max(w, h)
  const hauteur = Math.round(h * echelle + 2 * marge)
  const dessin = (p: [number, number]): [number, number] => [
    marge + (p[0] - minX) * echelle + ((largeur - 2 * marge) - w * echelle) / 2,
    marge + (p[1] - minY) * echelle,
  ]
  const centre = dessin([(minX + maxX) / 2, (minY + maxY) / 2])

  const cotes: Cote[] = murs(contour).map((m) => {
    const a = dessin(enM(m.a))
    const b = dessin(enM(m.b))
    const milieu: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    // Vers l'extérieur : à l'opposé du centre du dessin, perpendiculairement au mur.
    let nx = -(b[1] - a[1])
    let ny = b[0] - a[0]
    const n = Math.hypot(nx, ny) || 1
    nx /= n
    ny /= n
    if ((milieu[0] - centre[0]) * nx + (milieu[1] - centre[1]) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    return {
      orientation: m.orientation,
      longueur: m.longueur,
      a,
      b,
      etiquette: [milieu[0] + nx * 14, milieu[1] + ny * 14],
    }
  })

  return { largeur, hauteur, contour: pts.map(dessin), cotes }
}

/**
 * L'élévation d'une façade : ses murs côte à côte, vus de face, chacun avec sa
 * silhouette relevée (le pignon monte, le terrain descend), sa longueur, ses
 * hauteurs, et la partie mitoyenne à hachurer.
 */
export interface Elevation {
  largeur: number
  hauteur: number
  /** Ordonnée du sol, dans le repère du dessin. */
  sol: number
  murs: {
    contour: [number, number][]
    mitoyens: [number, number][][]
    /** La longueur, écrite sous le mur. */
    cote: { x: number; y: number; texte: number } | null
    /** Les hauteurs à écrire : au bout gauche, et au faîte d'un pignon. */
    hauteurs: { x: number; y: number; texte: number }[]
  }[]
}

export function geometrieElevation(
  murs: { longueur: number; profil: [number, number][]; mitoyen?: [number, number][]; type: string; hauteurBasse: number; hauteurHaute: number }[],
  largeur = 320,
  hauteurMax = 150,
): Elevation | null {
  const vus = murs.filter((m) => m.profil.length >= 2 && m.longueur > 0)
  if (!vus.length) return null
  const ECART = 0.8, MARGE = 16, HAUT = 20, BAS = 22
  const total = vus.reduce((s, m) => s + m.longueur, 0) + ECART * (vus.length - 1)
  const H = Math.max(1, ...vus.map((m) => Math.max(...m.profil.map((p) => p[1]))))
  const k = Math.min((largeur - 2 * MARGE) / total, hauteurMax / H)
  const sol = HAUT + k * H
  const X = (x: number) => MARGE + k * x
  const Y = (h: number) => sol - k * h
  let x0 = 0
  const sortie: Elevation['murs'] = []
  for (const m of vus) {
    const profil = [...m.profil].sort((a, b) => a[0] - b[0])
    const contour: [number, number][] = [
      [X(x0), sol],
      ...profil.map(([s, h]) => [X(x0 + s), Y(h)] as [number, number]),
      [X(x0 + m.longueur), sol],
    ]
    const hauteurEn = (s: number) => {
      for (let i = 0; i + 1 < profil.length; i++) {
        const [s0, h0] = profil[i], [s1, h1] = profil[i + 1]
        if (s >= s0 && s <= s1) return s1 > s0 ? h0 + ((h1 - h0) * (s - s0)) / (s1 - s0) : h0
      }
      return s <= profil[0][0] ? profil[0][1] : profil[profil.length - 1][1]
    }
    const mitoyens = (m.mitoyen ?? []).map(([de, a]) => [
      [X(x0 + de), sol],
      [X(x0 + de), Y(hauteurEn(de))],
      ...profil.filter(([s]) => s > de && s < a).map(([s, h]) => [X(x0 + s), Y(h)] as [number, number]),
      [X(x0 + a), Y(hauteurEn(a))],
      [X(x0 + a), sol],
    ] as [number, number][])
    const hauteurs = [{ x: X(x0) + 3, y: Y(profil[0][1]) - 4, texte: profil[0][1] }]
    if (m.type === 'pignon') {
      const [sMax, hMax] = profil.reduce((a, b) => (b[1] > a[1] ? b : a))
      hauteurs.push({ x: X(x0 + sMax), y: Y(hMax) - 5, texte: hMax })
    }
    sortie.push({
      contour,
      mitoyens,
      cote: m.longueur >= 1.5 ? { x: X(x0 + m.longueur / 2), y: sol + 14, texte: m.longueur } : null,
      hauteurs,
    })
    x0 += m.longueur + ECART
  }
  return { largeur, hauteur: sol + BAS, sol, murs: sortie }
}
