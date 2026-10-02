// Lire une façade sur une photo : ce qu'on demande à la vision, la forme
// imposée de sa réponse, et ce qu'on en tire. Sans Deno ni réseau — l'appel
// lui-même est dans la fonction `facade-photo`.
//
// L'ÉCHELLE SANS RÈGLE
//
// Sur une photo de rue, on ne connaît ni l'objectif exact ni la hauteur de
// l'appareil. On ne mesure donc pas les fenêtres en pixels : on mesure leur
// PART dans le mur, sous la gouttière, et on l'applique à la surface que le
// LiDAR a mesurée (longueur × hauteur à la gouttière). Une photo de biais
// rétrécit fenêtres et mur ensemble : la part tient.

export type TypeOuverture = 'fenetre' | 'porte_fenetre' | 'porte' | 'garage' | 'baie' | 'soupirail' | 'autre'

/** Une boîte en coordonnées normalisées : 0 à 1000 de gauche à droite, et de haut en bas. */
export interface Boite {
  gauche: number
  haut: number
  droite: number
  bas: number
}

export interface LectureVision {
  facade_visible: boolean
  /** La façade vue est-elle bien celle de cette maison ? */
  meme_maison: 'oui' | 'probable' | 'douteux' | 'non'
  cadre: Boite | null
  /** Le pied du mur et la gouttière, au milieu de la façade (0 à 1000, de haut en bas). */
  ligne_sol: number | null
  ligne_gouttiere: number | null
  mur_entier: boolean
  /** Part de la façade cachée (arbres, voitures, clôture), de 0 à 1. */
  part_cachee: number
  niveaux: number | null
  ouvertures: (Boite & { type: TypeOuverture })[]
  materiau: string
  remarque: string
}

const boite = {
  type: 'object',
  properties: {
    gauche: { type: 'integer' },
    haut: { type: 'integer' },
    droite: { type: 'integer' },
    bas: { type: 'integer' },
  },
  required: ['gauche', 'haut', 'droite', 'bas'],
  additionalProperties: false,
}

/** Le schéma imposé à la réponse (sorties structurées). */
export const SCHEMA_LECTURE = {
  type: 'object',
  properties: {
    facade_visible: { type: 'boolean' },
    meme_maison: { type: 'string', enum: ['oui', 'probable', 'douteux', 'non'] },
    cadre: { anyOf: [boite, { type: 'null' }] },
    ligne_sol: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    ligne_gouttiere: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    mur_entier: { type: 'boolean' },
    part_cachee: { type: 'number' },
    niveaux: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    ouvertures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['fenetre', 'porte_fenetre', 'porte', 'garage', 'baie', 'soupirail', 'autre'] },
          ...boite.properties,
        },
        required: ['type', 'gauche', 'haut', 'droite', 'bas'],
        additionalProperties: false,
      },
    },
    materiau: { type: 'string' },
    remarque: { type: 'string' },
  },
  required: [
    'facade_visible',
    'meme_maison',
    'cadre',
    'ligne_sol',
    'ligne_gouttiere',
    'mur_entier',
    'part_cachee',
    'niveaux',
    'ouvertures',
    'materiau',
    'remarque',
  ],
  additionalProperties: false,
}

export interface ContexteFacade {
  orientation: string
  /** Photo de rue ou photo de l'artisan. */
  origine: 'rue' | 'artisan'
  longueur: number
  hauteurGouttiere: number
  type: string
  /** Où le mur doit apparaître (rue seulement), 0 à 1000. */
  colonnes?: [number, number] | null
  distance?: number | null
  toit?: string | null
}

/** La consigne : ce qu'on sait déjà de la façade, et ce qu'on attend. */
export function consigne(c: ContexteFacade): string {
  const ou =
    c.origine === 'rue' && c.colonnes
      ? `C'est une photo de rue${c.distance ? `, prise à environ ${Math.round(c.distance)} m de la façade` : ''}. D'après la position de l'appareil, connue à quelques mètres près, la façade devrait se trouver vers les abscisses ${c.colonnes[0]} à ${c.colonnes[1]} (sur 1000, de gauche à droite) : elle peut déborder un peu de cette zone. Choisis le bâtiment dont les proportions correspondent au mur relevé ; si aucun ne correspond, ou si une haie, un arbre ou une voiture le cache, dis-le.`
      : "C'est une photo prise par l'artisan devant la façade."
  const niveaux = Math.max(1, Math.round(c.hauteurGouttiere / 2.8))
  return [
    `Façade ${c.orientation} d'une maison${c.toit ? ` (toit : ${c.toit})` : ''}. Mesures relevées au LiDAR : mur de ${c.longueur.toFixed(1)} m de long, ${c.hauteurGouttiere.toFixed(1)} m jusqu'à la gouttière (environ ${niveaux} niveau${niveaux > 1 ? 'x' : ''}), ${c.type === 'pignon' ? 'pignon (pointe sous le toit)' : 'mur gouttereau'} — un mur ${c.longueur > c.hauteurGouttiere * 1.3 ? 'plus large que haut' : c.longueur < c.hauteurGouttiere * 0.8 ? 'plus haut que large' : 'à peu près aussi large que haut'}.`,
    ou,
    "Toutes les coordonnées sont normalisées de 0 à 1000 : x de gauche à droite, y de haut en bas de l'image.",
    '- cadre : la façade de CETTE maison (de la gauche à la droite du mur, du toit au sol) ; null si elle ne se voit pas.',
    '- ligne_sol et ligne_gouttiere : la hauteur, au milieu de la façade, du pied du mur et du bas de la toiture.',
    '- ouvertures : chaque fenêtre, porte, porte-fenêtre, porte de garage, baie ou soupirail de cette façade, avec sa boîte (le tableau de la menuiserie, sans les volets ouverts). Ne compte pas celles des maisons voisines ni celles de la toiture.',
    "- mur_entier : vrai si toute la largeur du mur est dans l'image.",
    '- part_cachee : la part de la façade masquée par des arbres, des véhicules, une clôture.',
    '- niveaux : le nombre de niveaux visibles (rez-de-chaussée compris).',
    '- materiau : enduit, pierre, brique, bardage… en quelques mots ; remarque : ce qui gêne la lecture, ou rien.',
    "Si la zone montre autre chose que la maison, mets meme_maison à « non » et n'invente rien.",
  ].join('\n')
}

/**
 * Surfaces types (m²), et bornes plausibles : une fenêtre courante fait
 * 1,5 m² (1,20 × 1,25), une porte 2 m², une porte de garage 5,5 m².
 */
export const SURFACES_TYPES: Record<TypeOuverture, { type: number; min: number; max: number }> = {
  fenetre: { type: 1.5, min: 0.3, max: 3.5 },
  porte_fenetre: { type: 3, min: 1.8, max: 5 },
  porte: { type: 2, min: 1.6, max: 3.2 },
  garage: { type: 5.5, min: 4, max: 8 },
  baie: { type: 4, min: 2, max: 9 },
  soupirail: { type: 0.3, min: 0.1, max: 0.8 },
  autre: { type: 1.5, min: 0.2, max: 4 },
}

/** Sous cette largeur de façade dans l'image (pixels), on ne mesure pas les ouvertures : on les compte. */
export const LARGEUR_MESURABLE = 400

export interface Ouvertures {
  nombre: number
  parType: Partial<Record<TypeOuverture, number>>
  /** Surface des ouvertures, en m², rapportée au mur relevé ; null si la lecture ne le permet pas. */
  surface: number | null
  /**
   * `mesure` : chaque ouverture mesurée sur la photo (à l'échelle du mur
   * relevé), bornée à une taille plausible ; `forfait` : façade trop petite
   * dans l'image, chaque ouverture comptée à sa surface type.
   */
  methode: 'mesure' | 'forfait' | null
  /** Hauteur à la gouttière vue sur la photo (m), pour contrôle ; null si la vue ne s'y prête pas. */
  hauteurPhoto: number | null
  /** La lecture peut-elle servir à déduire les ouvertures ? Sinon, pourquoi. */
  utilisable: boolean
  motif: string | null
}

/**
 * Ce qu'on tire d'une lecture : le nombre d'ouvertures, leur surface (par la
 * part que chacune prend dans le mur sous la gouttière, ou à sa surface type
 * sur une photo lointaine), et une hauteur de contrôle quand la vue est de
 * face et le mur entier.
 *
 * @param proportions largeur ÷ hauteur de l'image (les coordonnées sont normalisées).
 */
export function tirerOuvertures(
  l: LectureVision,
  mur: { longueur: number; hauteurGouttiere: number },
  proportions: number,
  incidence: number | null,
  origine: 'rue' | 'artisan' = 'rue',
  largeurImage = 2048,
): Ouvertures {
  const parType: Partial<Record<TypeOuverture, number>> = {}
  for (const o of l.ouvertures) parType[o.type] = (parType[o.type] ?? 0) + 1
  const base = { nombre: l.ouvertures.length, parType }
  const vide = { surface: null, methode: null, hauteurPhoto: null, utilisable: false } as const
  if (!l.facade_visible || !l.cadre) return { ...base, ...vide, motif: 'facade_invisible' }
  // Sur une photo de rue, un doute suffit à écarter la lecture ; sur la
  // photo de l'artisan, prise devant la maison, seul un « non » l'écarte.
  if (l.meme_maison === 'non' || (l.meme_maison === 'douteux' && origine === 'rue')) {
    return { ...base, ...vide, motif: 'autre_batiment' }
  }
  const sol = l.ligne_sol ?? l.cadre.bas
  const gouttiere = l.ligne_gouttiere ?? l.cadre.haut
  const largeur = l.cadre.droite - l.cadre.gauche
  const hauteur = sol - gouttiere
  if (largeur <= 0 || hauteur <= 0) return { ...base, ...vide, motif: 'cadre_invalide' }
  const surfaceMur = mur.longueur * mur.hauteurGouttiere
  // Chaque ouverture : sa part du rectangle du mur sous la gouttière, rapportée
  // au mur relevé, bornée à une taille plausible pour son type. Une façade
  // trop petite dans l'image (photo lointaine) ne se mesure pas : ses
  // ouvertures comptent pour leur surface type.
  const mesurable = (largeur / 1000) * largeurImage >= LARGEUR_MESURABLE
  let surface = 0
  for (const o of l.ouvertures) {
    const t = SURFACES_TYPES[o.type] ?? SURFACES_TYPES.autre
    if (!mesurable) {
      surface += t.type
      continue
    }
    const w = Math.max(0, Math.min(o.droite, l.cadre.droite) - Math.max(o.gauche, l.cadre.gauche))
    const h = Math.max(0, Math.min(o.bas, sol) - Math.max(o.haut, gouttiere))
    const m2 = ((w * h) / (largeur * hauteur)) * surfaceMur
    surface += Math.min(t.max, Math.max(t.min, m2))
  }
  surface = Math.min(0.8 * surfaceMur, surface)
  // Une façade à moitié cachée ou coupée : les ouvertures qu'on ne voit pas
  // manquent. On le dit plutôt que de sous-estimer sans prévenir.
  const partielle = !l.mur_entier || l.part_cachee > 0.3
  // Hauteur de contrôle : de face (moins de 30°), mur entier. La largeur vue
  // est la longueur raccourcie par l'angle ; les coordonnées normalisées se
  // remettent en pixels par les proportions de l'image.
  const hauteurPhoto =
    l.mur_entier && incidence !== null && incidence < 30
      ? Math.round(((hauteur / (largeur * proportions)) * mur.longueur * Math.cos((incidence * Math.PI) / 180)) * 10) / 10
      : null
  return {
    ...base,
    surface: Math.round(surface * 10) / 10,
    methode: mesurable ? 'mesure' : 'forfait',
    hauteurPhoto,
    utilisable: !partielle,
    motif: partielle ? 'facade_partielle' : null,
  }
}

/** Ce qu'une lecture garde, avec la photo : la réponse de la vision, ce qu'on en a tiré, le mur relevé. */
export interface LectureGardee {
  vision: LectureVision
  resultat: Ouvertures
  mur: { longueur: number; hauteurGouttiere: number; surfaceLibre: number }
}

/** Une photo de façade, telle que la table `facade_photo` la garde. */
export interface PhotoLue {
  id: string
  orientation: string
  source: 'panoramax' | 'mapillary' | 'artisan'
  largeur: number | null
  hauteur: number | null
  incidence: number | null
  lecture: LectureGardee | null
  /** Les rangs des ouvertures que l'artisan a retirées : une fausse détection, un reflet. */
  ecartees?: number[] | null
}

/**
 * La photo d'une façade qui compte : celle de l'artisan (il l'a prise pour
 * ça), sinon une photo de rue déjà lue, sinon la première.
 */
export function photoDeLaFacade<T extends PhotoLue>(photos: T[], orientation: string): T | null {
  const ici = photos.filter((p) => p.orientation === orientation)
  // Celle de l'artisan d'abord ; puis une photo lue ET exploitable (la mauvaise — autre maison, façade cachée — est écartée) ; puis n'importe quelle lue.
  const bonne = (p: T) => !!p.lecture && p.lecture.resultat.utilisable && p.lecture.resultat.motif !== 'autre_batiment'
  return ici.find((p) => p.source === 'artisan') ?? ici.find(bonne) ?? ici.find((p) => p.lecture) ?? ici[0] ?? null
}

/** Ce que la lecture donne, sans les ouvertures que l'artisan a retirées. */
export function resultatRetenu(p: PhotoLue): Ouvertures | null {
  const l = p.lecture
  if (!l) return null
  const ecartees = new Set(p.ecartees ?? [])
  if (!ecartees.size) return l.resultat
  return tirerOuvertures(
    { ...l.vision, ouvertures: l.vision.ouvertures.filter((_, i) => !ecartees.has(i)) },
    l.mur,
    p.largeur && p.hauteur ? p.largeur / p.hauteur : 4 / 3,
    p.source === 'artisan' ? null : p.incidence,
    p.source === 'artisan' ? 'artisan' : 'rue',
    p.largeur ?? 2048,
  )
}
