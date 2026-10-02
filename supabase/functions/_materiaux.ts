// Le matériau du toit, lu par Claude sur la photo aérienne de l'IGN : ce qu'on
// lui montre (un extrait centré sur le toit relevé), ce qu'on lui demande, la
// forme imposée de sa réponse. Sans Deno ni réseau — l'appel est dans la
// fonction `facade-photo`.
//
// LA PHOTO
//
// L'orthophoto à 20 cm couvre toute la France : une tuile y fait un pixel, un
// toit se lit à sa couleur et à sa texture (rangs de tuiles, joints debout du
// zinc, nervures du bac acier). Là où l'IGN a la photo à 5 cm (Paris, la
// petite couronne, quelques villes), on la prend : les fenêtres de toit et les
// cheminées s'y comptent.

import { versLambert93 } from './_calcul-toit.ts'
import type { Releve } from './_releve.ts'

export type MateriauToit =
  | 'tuile_mecanique'
  | 'tuile_canal'
  | 'tuile_plate'
  | 'ardoise'
  | 'zinc'
  | 'bac_acier'
  | 'membrane'
  | 'vegetalise'
  | 'fibrociment'
  | 'autre'
  | 'indetermine'

export const LIBELLES_TOIT: Record<MateriauToit, string> = {
  tuile_mecanique: 'Tuile mécanique',
  tuile_canal: 'Tuile canal',
  tuile_plate: 'Tuile plate',
  ardoise: 'Ardoise',
  zinc: 'Zinc',
  bac_acier: 'Bac acier',
  membrane: 'Membrane d’étanchéité',
  vegetalise: 'Toit végétalisé',
  fibrociment: 'Fibrociment',
  autre: 'Autre',
  indetermine: 'Indéterminé',
}

export interface LectureToit {
  meme_batiment: boolean
  materiau: MateriauToit
  /** Tel qu'on le voit : « tuile rouge », « ardoise grise »… */
  couleur: string
  confiance: 'haute' | 'moyenne' | 'basse'
  /** Comptés seulement sur la photo à 5 cm ; null sinon. */
  fenetres_toit: number | null
  cheminees: number | null
  panneaux_solaires: boolean
  remarque: string
}

/** Ce qu'on garde, avec le relevé de la maison. */
export interface MateriauxGardes {
  toit: LectureToit
  /** Résolution de la photo lue (cm par pixel). */
  resolution_cm: number
  lu_le: string
  lu_par: string | null
  modele: string | null
}

const entier = { anyOf: [{ type: 'integer' }, { type: 'null' }] }

export const SCHEMA_TOIT = {
  type: 'object',
  properties: {
    meme_batiment: { type: 'boolean' },
    materiau: { type: 'string', enum: Object.keys(LIBELLES_TOIT) },
    couleur: { type: 'string' },
    confiance: { type: 'string', enum: ['haute', 'moyenne', 'basse'] },
    fenetres_toit: entier,
    cheminees: entier,
    panneaux_solaires: { type: 'boolean' },
    remarque: { type: 'string' },
  },
  required: ['meme_batiment', 'materiau', 'couleur', 'confiance', 'fenetres_toit', 'cheminees', 'panneaux_solaires', 'remarque'],
  additionalProperties: false,
}

/** Autour du toit, de quoi voir ses bords et un peu de ses voisins. */
const MARGE_M = 3
/** Côté le plus long de l'image envoyée. */
const COTE_PX = 1024

/**
 * L'extrait à demander à l'IGN : le toit relevé et 3 m autour, en Lambert-93,
 * et le contour du toit dans l'image (0 à 1000, y vers le bas).
 */
export function cadreDuToit(r: Releve, resolution_cm: number) {
  const P = r.toit.map(([lon, lat]) => versLambert93(lon, lat))
  const minX = Math.min(...P.map((p) => p[0])) - MARGE_M, maxX = Math.max(...P.map((p) => p[0])) + MARGE_M
  const minY = Math.min(...P.map((p) => p[1])) - MARGE_M, maxY = Math.max(...P.map((p) => p[1])) + MARGE_M
  const w = maxX - minX, h = maxY - minY
  // À la résolution de la photo, sans dépasser COTE_PX ni descendre sous 512 px
  // (en dessous, la vision lit mal ; au-dessus, l'IGN n'a rien de plus à montrer).
  const k = Math.min(COTE_PX, Math.max(512, Math.max(w, h) / (resolution_cm / 100))) / Math.max(w, h)
  const largeur = Math.round(w * k), hauteur = Math.round(h * k)
  const contour = P.map(([x, y]) => [Math.round(((x - minX) / w) * 1000), Math.round(((maxY - y) / h) * 1000)] as [number, number])
  return { bbox: [minX, minY, maxX, maxY] as [number, number, number, number], largeur, hauteur, contour }
}

/** L'adresse de l'extrait (WMS raster de l'IGN, Lambert-93). */
export function urlOrtho(
  bbox: [number, number, number, number],
  largeur: number,
  hauteur: number,
  tresFine: boolean,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg',
): string {
  const couche = tresFine ? 'THR.ORTHOIMAGERY.ORTHOPHOTOS' : 'HR.ORTHOIMAGERY.ORTHOPHOTOS'
  return (
    `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&FORMAT=${format}&CRS=EPSG:2154` +
    `&LAYERS=${couche}&BBOX=${bbox.map((v) => v.toFixed(2)).join(',')}&WIDTH=${largeur}&HEIGHT=${hauteur}`
  )
}

/** La consigne : ce qu'on sait déjà du toit, et ce qu'on attend. */
export function consigneToit(r: Releve, contour: [number, number][], resolution_cm: number): string {
  const pans = r.pans.filter((p) => !p.terrasse)
  const pente = pans.length ? Math.round(pans.reduce((s, p) => s + p.pente * p.aireVraie, 0) / pans.reduce((s, p) => s + p.aireVraie, 0)) : null
  const fine = resolution_cm <= 10
  return [
    `Photo aérienne verticale de l'IGN, ${resolution_cm} cm par pixel, nord en haut. Au centre, le toit d'une maison relevé au LiDAR : ${pans.length} pan${pans.length > 1 ? 's' : ''}${pente != null ? `, pente moyenne ${pente} %` : ''}.`,
    `Son contour dans l'image (x de 0 à 1000 de gauche à droite, y de 0 à 1000 de haut en bas) : ${contour.map(([x, y]) => `(${x}, ${y})`).join(' ')}.`,
    '- meme_batiment : vrai si un toit occupe bien ce contour (faux si la photo montre un terrain vide, un chantier, un autre bâtiment).',
    '- materiau : la couverture de CE toit, à sa couleur et à sa texture — tuile mécanique (rangs réguliers, ondulée), tuile canal (rangs arrondis, Sud), tuile plate, ardoise (gris-bleu, fine), zinc (gris clair, joints debout), bac acier (nervures régulières), membrane (toit plat, uni), végétalisé, fibrociment (plaques ondulées grises). « indetermine » si la photo ne permet pas de trancher.',
    '- couleur : la teinte vue, en quelques mots.',
    '- confiance : haute si le matériau ne fait pas de doute, basse si tu hésites entre deux.',
    fine
      ? '- fenetres_toit et cheminees : combien sur ce toit.'
      : '- fenetres_toit et cheminees : null — à cette résolution, on ne les compte pas.',
    '- panneaux_solaires : vrai si des panneaux couvrent une partie du toit.',
    "- remarque : ce qui gêne la lecture (ombre, arbre, flou), ou rien. N'invente rien.",
  ].join('\n')
}

/** Le matériau de la BDNB (`mat_toit_txt`), faute de lecture : une déclaration, pas une mesure. */
export function materiauDeBdnb(texte: string | null | undefined): MateriauToit | null {
  const t = (texte ?? '').toLowerCase()
  if (!t || /inconnu|indetermin/.test(t)) return null
  if (/ardoise/.test(t)) return 'ardoise'
  if (/zinc|alumin/.test(t)) return 'zinc'
  if (/tuile/.test(t)) return 'tuile_mecanique'
  if (/b[ée]ton|terrasse|asphalt|bitum/.test(t)) return 'membrane'
  if (/t[ôo]le|acier|m[ée]tal/.test(t)) return 'bac_acier'
  if (/fibro|amiante/.test(t)) return 'fibrociment'
  return 'autre'
}
