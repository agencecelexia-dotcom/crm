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
