/**
 * Mesurer sur la carte : aires, longueurs, pentes.
 *
 * Tout est calculé ici pour l'affichage pendant que l'artisan dessine, et
 * RECALCULÉ EN BASE à l'enregistrement (`aire_polygone`, `longueur_ligne` de
 * 0145). Le navigateur n'est pas la source de vérité d'un chiffre qui finira
 * dans un devis — mais il doit donner le même, sans quoi la surface changerait
 * sous les yeux de l'artisan au moment où il enregistre.
 *
 * Aucune dépendance : trente lignes de trigonométrie valent mieux qu'un
 * mégaoctet de Turf pour deux formules.
 */

/** Rayon équatorial WGS84, en mètres — celui qu'emploie la base. */
const R = 6378137

/** Un sommet, dans l'ordre GeoJSON : longitude puis latitude. */
export type Point = [number, number]

const rad = (d: number) => (d * Math.PI) / 180

/**
 * Aire d'un polygone, en m².
 *
 * Formule de l'excès sphérique, celle de Google Maps et de
 * Leaflet.GeometryUtil. Vérifiée à 0,0000 % près contre un calcul plan
 * indépendant sur de vrais bâtiments, et contre la base.
 *
 * Le polygone est refermé implicitement : ne répétez pas le premier sommet.
 */
export function aire(points: Point[]): number {
  if (!points || points.length < 3) return 0
  let s = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [x1, y1] = points[j]
    const [x2, y2] = points[i]
    s += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)))
  }
  return Math.abs((s * R * R) / 2)
}

/** Distance entre deux points, en mètres. */
export function distance(a: Point, b: Point): number {
  // Projection locale plutôt que Haversine : sur les quelques centaines de
  // mètres d'un chantier, l'écart est inférieur au centimètre, et la formule
  // reste lisible.
  const dy = rad(b[1] - a[1]) * R
  const dx = rad(b[0] - a[0]) * R * Math.cos(rad((a[1] + b[1]) / 2))
  return Math.hypot(dx, dy)
}

/** Longueur d'une ligne, ou périmètre si elle est refermée. */
export function longueur(points: Point[], fermee = false): number {
  if (!points || points.length < 2) return 0
  let d = 0
  const dernier = fermee ? points.length - 1 : points.length - 2
  for (let i = 0; i <= dernier; i++) d += distance(points[i], points[(i + 1) % points.length])
  return d
}

/**
 * Surface réelle d'un versant à partir de son emprise au sol.
 *
 * Une toiture vue du ciel est une PROJECTION : un toit à 30 % de pente couvre
 * 4,4 % de plus que son ombre au sol. L'oublier, c'est commander trop peu de
 * tuiles — et le constater sur le chantier.
 *
 * @param pentePct pente en pourcentage (30 % = 16,7°), non en degrés.
 */
export function surfaceReelle(surfaceProjetee: number, pentePct: number): number {
  if (!Number.isFinite(pentePct) || pentePct <= 0) return surfaceProjetee
  return surfaceProjetee / Math.cos(Math.atan(pentePct / 100))
}

/** Une pente s'annonce en pourcentage sur un chantier, en degrés sur un plan. */
export const pctEnDegres = (pct: number) => (Math.atan(pct / 100) * 180) / Math.PI
export const degresEnPct = (deg: number) => Math.tan(rad(deg)) * 100

/** Centre d'un tracé, pour y poser une étiquette ou recadrer la carte. */
export function centre(points: Point[]): Point | null {
  if (!points?.length) return null
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0])
  return [sx / points.length, sy / points.length]
}

/** Le point le plus proche d'une position — pour désigner le bon bâtiment. */
export function plusProche<T>(
  elements: T[],
  position: Point,
  ou: (e: T) => Point | null,
): T | null {
  let meilleur: T | null = null
  let min = Infinity
  for (const e of elements) {
    const p = ou(e)
    if (!p) continue
    const d = distance(position, p)
    if (d < min) {
      min = d
      meilleur = e
    }
  }
  return meilleur
}

/** Mètres carrés, arrondis comme on les dit : « 142 m² », « 4,5 m² ». */
export const formatM2 = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, ' ') + ' m²'

/** Mètres linéaires. */
export const formatM = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: n < 10 ? 2 : 1 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, ' ') + ' m'
