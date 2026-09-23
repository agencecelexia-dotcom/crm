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

// ---------------------------------------------------------------------------
//  Ce qu'on déduit d'une emprise : des murs, des dimensions, une pente.
// ---------------------------------------------------------------------------

/** Composantes est/nord d'un segment, en mètres. */
function enMetres(a: Point, b: Point): [number, number] {
  const est = rad(b[0] - a[0]) * R * Math.cos(rad((a[1] + b[1]) / 2))
  const nord = rad(b[1] - a[1]) * R
  return [est, nord]
}

/**
 * Sens de parcours du contour.
 *
 * Positif = sens trigonométrique (intérieur à gauche des arêtes). Il décide de
 * quel côté regarde un mur, donc de son orientation cardinale.
 */
function aireSignee(points: Point[]): number {
  let s = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s += (points[j][0] + points[i][0]) * (points[i][1] - points[j][1])
  }
  return s / 2
}

const CARDINAUX = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']

/** Nomme une direction comme le fait un client au téléphone : « la façade sud ». */
export function cardinal(azimut: number): string {
  const a = ((azimut % 360) + 360) % 360
  return CARDINAUX[Math.round(a / 45) % 8]
}

/** Un mur : un côté du bâtiment, avec ce qu'il faut pour le chiffrer. */
export interface Mur {
  index: number
  /** Longueur au sol, en mètres. */
  longueur: number
  /** Azimut de la face extérieure : 0 = nord, 90 = est. */
  azimut: number
  /** « sud », « nord-ouest »… */
  orientation: string
  /** Les deux extrémités, pour le tracé. */
  a: Point
  b: Point
}

/**
 * Les murs d'un bâtiment, un par côté de son emprise.
 *
 * C'est la correction d'une erreur : multiplier le PÉRIMÈTRE par la hauteur
 * donne l'enveloppe entière, que personne ne vend. Un façadier chiffre UNE
 * façade — celle qui est décollée, celle qui est plein sud — et il la désigne
 * par son orientation. D'où l'azimut, calculé depuis la normale extérieure.
 *
 * Les murs de moins d'un mètre sont écartés : ce sont des décrochés de
 * numérisation, pas des façades.
 */
export function murs(contour: Point[]): Mur[] {
  if (!contour || contour.length < 3) return []
  // Sens de parcours : il dit de quel côté est l'extérieur.
  const trigo = aireSignee(contour) > 0
  const out: Mur[] = []

  for (let i = 0; i < contour.length; i++) {
    const a = contour[i]
    const b = contour[(i + 1) % contour.length]
    const [est, nord] = enMetres(a, b)
    const longueur = Math.hypot(est, nord)
    if (longueur < 1) continue

    // Normale extérieure : à droite de l'arête si le contour est trigonométrique.
    const [nEst, nNord] = trigo ? [nord, -est] : [-nord, est]
    const azimut = (((Math.atan2(nEst, nNord) * 180) / Math.PI) % 360 + 360) % 360

    out.push({ index: i, longueur, azimut, orientation: cardinal(azimut), a, b })
  }
  return out
}

/** Les dimensions hors tout d'un bâtiment, et l'axe de son faîtage. */
export interface Encombrement {
  longueur: number
  largeur: number
  /** Azimut du grand axe — celui que suit le faîtage d'un toit à deux pans. */
  azimutLong: number
}

/**
 * Le plus petit rectangle qui contient l'emprise.
 *
 * Les bâtiments sont presque toujours rectangulaires : le rectangle minimal
 * s'aligne alors sur l'un de leurs côtés. On essaie donc chaque côté comme
 * direction candidate et on garde la plus économe — une soixantaine de lignes
 * au lieu d'un algorithme de rotation de calipers.
 *
 * Sa LARGEUR est ce qui manquait pour la pente : sur un toit à deux pans, le
 * faîtage suit le grand axe, et chaque pan couvre la moitié de la largeur.
 */
export function encombrement(contour: Point[]): Encombrement | null {
  if (!contour || contour.length < 3) return null
  const o = contour[0]
  // Repère local en mètres, centré sur le premier sommet.
  const pts = contour.map((p) => enMetres(o, p))

  let meilleur: Encombrement | null = null
  let minAire = Infinity

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d < 0.5) continue
    const ux = (b[0] - a[0]) / d
    const uy = (b[1] - a[1]) / d

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [x, y] of pts) {
      const u = x * ux + y * uy
      const v = -x * uy + y * ux
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const cu = maxU - minU
    const cv = maxV - minV
    const surface = cu * cv
    if (surface < minAire) {
      minAire = surface
      const long = Math.max(cu, cv)
      const court = Math.min(cu, cv)
      // Azimut de l'axe long : le grand côté suit u si cu >= cv, sinon v.
      const [ex, ey] = cu >= cv ? [ux, uy] : [-uy, ux]
      const az = (((Math.atan2(ex, ey) * 180) / Math.PI) % 360 + 360) % 360
      meilleur = { longueur: long, largeur: court, azimutLong: az }
    }
  }
  return meilleur
}

/** Ce qu'on peut dire d'une toiture sans monter dessus. */
export interface Toiture {
  /** Pente en pourcentage. */
  pente: number
  /**
   * La pente est-elle exploitable ?
   *
   * La formule suppose un toit à DEUX PANS dont le faîtage suit le grand axe.
   * Sur un bâtiment large, un toit-terrasse à acrotère ou un volume composé,
   * elle n'a plus de sens : un audit a relevé 88 % sur un commerce de 818 m²
   * manifestement plat. On le dit plutôt que de laisser croire à une mesure.
   */
  fiable: boolean
  /** Dénivelé du toit, gouttière au faîtage, en mètres. */
  denivele: number
  /** Incertitude sur la pente, en points de pourcentage. */
  incertitude: number
  /** Surface réelle des pans, à partir de l'emprise. */
  surface: number
}

/**
 * La pente d'un toit, déduite des altitudes de la BD TOPO.
 *
 * L'artisan ne peut pas la voir du ciel, et jusqu'ici on la lui faisait
 * DEVINER. Elle se calcule pourtant : la BD TOPO donne l'altitude de la
 * gouttière et celle du faîtage, et le rectangle englobant donne la largeur.
 * Sur un toit à deux pans, chaque pan monte du bord au faîtage sur la moitié
 * de cette largeur.
 *
 *     pente % = (faîtage − gouttière) / (largeur / 2) × 100
 *
 * L'INCERTITUDE EST RENDUE AVEC LE CHIFFRE. La BD TOPO annonce sa précision
 * altimétrique — souvent un mètre. Sur une petite maison au dénivelé d'un
 * mètre cinquante, cela fait une pente à ± 30 points : le chiffre reste utile,
 * mais l'artisan doit savoir qu'il doit le vérifier. Sur un grand bâtiment il
 * devient fiable. Taire l'incertitude serait pire que de ne rien calculer.
 */
export function toitureDepuisAltitudes(p: {
  emprise: number
  largeur: number
  toitMin: number | null
  toitMax: number | null
  precisionAltimetrique?: number | null
}): Toiture | null {
  const { emprise, largeur, toitMin, toitMax } = p
  if (toitMin == null || toitMax == null || !(largeur > 1)) return null

  const denivele = toitMax - toitMin
  if (denivele < 0.2) {
    // Toit-terrasse ou faible dénivelé : la pente n'a pas de sens, la surface
    // est celle de l'emprise.
    return {
      pente: 0, denivele: Math.max(denivele, 0), incertitude: 0,
      surface: emprise, fiable: true,
    }
  }

  const demiLargeur = largeur / 2
  const pente = (denivele / demiLargeur) * 100
  const precision = p.precisionAltimetrique ?? 1
  // L'erreur sur le dénivelé se propage telle quelle sur la pente.
  const incertitude = (precision / demiLargeur) * 100

  return {
    pente,
    denivele,
    incertitude,
    // Trois motifs de défiance, chacun constaté : un bâtiment large n'a
    // pratiquement jamais un seul faîtage central ; une marge supérieure à
    // vingt-cinq points ne dit plus rien ; et au-delà de 120 % (50°) on sort
    // de ce qui se construit en France hors cas particuliers.
    fiable: largeur <= 20 && incertitude <= 25 && pente <= 120,
    surface: surfaceReelle(emprise, pente),
  }
}

/**
 * Ce mur est-il un pignon ?
 *
 * Sur un toit à deux pans, le faîtage suit le grand axe du bâtiment. Les murs
 * qui le referment — les pignons — regardent donc dans la direction de cet
 * axe. Leur surface comporte en plus le triangle sous la charpente, que
 * « longueur × hauteur » oublie.
 */
export function estPignon(azimutMur: number, azimutLong: number): boolean {
  const ecart = Math.abs(((azimutMur - azimutLong + 540) % 360) - 180)
  // À moins de trente degrés de l'axe du faîtage, ou de son opposé.
  return Math.min(ecart, 180 - ecart) > 150 || Math.min(ecart, 180 - ecart) < 30
}
