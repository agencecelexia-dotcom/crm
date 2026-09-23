import type { Encombrement, Mur, Point, Toiture } from './geometrie'
import { aire, centre, encombrement, longueur, murs, toitureDepuisAltitudes } from './geometrie'

/**
 * Le bâti de la BD TOPO, servi gratuitement par l'IGN.
 *
 * C'est le cœur du métré : le bâtiment du client est DÉJÀ TRACÉ, avec sa
 * hauteur. Dans le cas courant l'artisan ne dessine rien — il touche la maison
 * et lit son emprise, son périmètre et sa hauteur.
 *
 * DEUX PIÈGES, PAYÉS COMPTANT
 *
 * 1. Le CRS. Sans `SRSNAME=CRS:84` ET le suffixe `,CRS:84` sur la bbox, le
 *    service répond « 0 bâtiment » — pas une erreur, zéro résultat. On croit à
 *    une zone sans données alors qu'on a mal demandé.
 * 2. La géométrie. Les bâtiments arrivent en MultiPolygon, avec une altitude
 *    en troisième coordonnée et le premier sommet répété à la fin. Les trois
 *    doivent être traités, sinon l'aire est fausse ou le tracé se referme mal.
 */

const WFS = 'https://data.geopf.fr/wfs/ows'

/** Un bâtiment, tel qu'on le montre à l'artisan. */
export interface Batiment {
  id: string
  /** Identifiant BD TOPO — la clé qui rattache ce bâtiment au RNB, à la BDNB
   *  et au DPE. Sans elle, aucune fiche maison n'est possible. */
  cleabs: string | null
  contour: Point[]
  /** Emprise au sol, en m² — l'ombre du bâtiment, pas la surface de toiture. */
  emprise: number
  perimetre: number
  /** Hauteur au faîtage, en mètres. Absente sur une minorité de bâtiments. */
  hauteur: number | null
  nature: string | null
  usage: string | null
  centre: Point | null
  /** Un mur par côté, avec son orientation : c'est ce qu'on chiffre. */
  murs: Mur[]
  /** Dimensions hors tout, et axe du faîtage. */
  encombrement: Encombrement | null
  /**
   * La toiture déduite des altitudes, quand la BD TOPO les donne — environ six
   * bâtiments sur dix. Elle porte son incertitude : sur une petite maison, un
   * mètre de précision altimétrique laisse une marge considérable.
   */
  toiture: Toiture | null
  /** Ce que la BD TOPO sait d'autre, quand elle le sait. */
  etages: number | null
  logements: number | null
  materiauMurs: string | null
  materiauToiture: string | null
  anneeSource: string | null
}

/** Convertit un degré de longitude en mètres à cette latitude. */
const metresEnDegres = (m: number, lat: number) => ({
  lat: m / 111320,
  lon: m / (111320 * Math.cos((lat * Math.PI) / 180)),
})

/**
 * Les bâtiments autour d'un point.
 *
 * @param rayonM demi-côté de la fenêtre de recherche. 120 m couvre une
 *   parcelle et ses voisines sans noyer l'écran dans un lotissement.
 */
export async function batimentsAutour(
  lat: number,
  lon: number,
  rayonM = 120,
  signal?: AbortSignal,
): Promise<Batiment[]> {
  const d = metresEnDegres(rayonM, lat)
  const bbox = [lon - d.lon, lat - d.lat, lon + d.lon, lat + d.lat]
    .map((v) => v.toFixed(7))
    .join(',')

  const url = new URL(WFS)
  url.searchParams.set('SERVICE', 'WFS')
  url.searchParams.set('VERSION', '2.0.0')
  url.searchParams.set('REQUEST', 'GetFeature')
  url.searchParams.set('TYPENAMES', 'BDTOPO_V3:batiment')
  url.searchParams.set('SRSNAME', 'CRS:84')
  // Le suffixe de CRS sur la bbox n'est pas décoratif : sans lui le service
  // interprète l'ordre des axes autrement et ne renvoie rien.
  url.searchParams.set('BBOX', `${bbox},CRS:84`)
  url.searchParams.set('OUTPUTFORMAT', 'application/json')
  url.searchParams.set('COUNT', '60')

  const rep = await fetch(url, { signal })
  if (!rep.ok) throw new Error(`IGN ${rep.status}`)
  const json = (await rep.json()) as { features?: unknown[] }

  return (json.features ?? []).map(lireBatiment).filter((b): b is Batiment => b !== null)
}

type Geometrie = { type?: string; coordinates?: unknown }
type Feature = { id?: string; properties?: Record<string, unknown>; geometry?: Geometrie }

function lireBatiment(brut: unknown): Batiment | null {
  const f = brut as Feature
  const contour = premierAnneau(f?.geometry)
  if (contour.length < 3) return null

  const p = f.properties ?? {}
  const nb = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)
  const txt = (k: string) =>
    typeof p[k] === 'string' && p[k] && p[k] !== 'Indifférenciée' && p[k] !== 'Indifférencié'
      ? (p[k] as string)
      : null

  const hauteur = nb('hauteur')
  const emprise = aire(contour)
  const enc = encombrement(contour)

  return {
    id: String(f.id ?? p.cleabs ?? Math.random()),
    cleabs: typeof p.cleabs === 'string' ? p.cleabs : null,
    contour,
    emprise,
    perimetre: longueur(contour, true),
    hauteur: hauteur && hauteur > 0 ? hauteur : null,
    nature: txt('nature'),
    usage: txt('usage_1'),
    centre: centre(contour),
    murs: murs(contour),
    encombrement: enc,
    toiture: enc
      ? toitureDepuisAltitudes({
          emprise,
          largeur: enc.largeur,
          toitMin: nb('altitude_minimale_toit'),
          toitMax: nb('altitude_maximale_toit'),
          precisionAltimetrique: nb('precision_altimetrique'),
        })
      : null,
    etages: nb('nombre_d_etages'),
    logements: nb('nombre_de_logements'),
    materiauMurs: txt('materiaux_des_murs'),
    materiauToiture: txt('materiaux_de_la_toiture'),
    anneeSource: typeof p.date_d_apparition === 'string' ? p.date_d_apparition.slice(0, 4) : null,
  }
}

/**
 * L'anneau extérieur, quel que soit l'emballage.
 *
 * Polygon → `coordinates[0]` ; MultiPolygon → `coordinates[0][0]`. On ne garde
 * que longitude et latitude — la BD TOPO ajoute une altitude — et on retire le
 * sommet de fermeture, que nos formules referment elles-mêmes.
 */
function premierAnneau(g?: Geometrie): Point[] {
  const c = g?.coordinates as unknown
  if (!Array.isArray(c) || c.length === 0) return []

  const anneau = (g?.type === 'MultiPolygon' ? (c[0] as unknown[])?.[0] : c[0]) as unknown
  if (!Array.isArray(anneau)) return []

  const points = anneau
    .filter((s): s is number[] => Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'number')
    .map((s): Point => [s[0], s[1]])

  if (points.length > 2) {
    const [a, b] = [points[0], points[points.length - 1]]
    if (a[0] === b[0] && a[1] === b[1]) points.pop()
  }
  return points
}

/**
 * Surface d'UN mur, hauteur du bâtiment moins les ouvertures.
 *
 * Remplace l'ancien « périmètre × hauteur », qui donnait l'enveloppe entière du
 * bâtiment : personne ne vend ça. Un façadier chiffre la façade sud, celle qui
 * est décollée, et il en déduit les fenêtres.
 */
export function surfaceMur(mur: Mur, hauteur: number | null, ouvertures = 0): number | null {
  if (!hauteur || hauteur <= 0) return null
  return Math.max(0, mur.longueur * hauteur - Math.max(0, ouvertures))
}

/** L'enveloppe complète, quand il s'agit vraiment de tout traiter. */
export function surfaceEnveloppe(b: Batiment): number | null {
  return b.hauteur ? b.perimetre * b.hauteur : null
}
