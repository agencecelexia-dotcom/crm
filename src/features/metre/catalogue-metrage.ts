/**
 * Ce qu'un artisan a besoin de connaître, métier par métier — et ce qu'on en sait.
 *
 * Chaque quantité a trois vies : ce que le CLIENT en dit au téléphone (« ma
 * clôture fait dix mètres »), ce que l'outil MESURE (LiDAR, parcelle, photo),
 * et ce qu'on RETIENT après vérification. Ce catalogue dit, pour chacune :
 * son unité, la question à poser, et d'où l'outil peut la mesurer.
 *
 * La tolérance entre le dit et le mesuré dépend de l'UNITÉ, pas de la
 * quantité : c'est la même règle qu'applique la base (`verifier_metrage`).
 */

export type Unite = 'm2' | 'ml' | 'm' | 'pct' | 'u' | 'oui_non'

/** D'où l'outil tire la mesure, quand il sait la prendre. */
export type SourceMesure = 'toit' | 'facades' | 'hauteurs' | 'parcelle' | 'photo'

export interface Quantite {
  cle: string
  libelle: string
  unite: Unite
  /** La question à poser au client, telle qu'on la dit au téléphone. */
  question: string
  /** Null : l'outil ne sait pas la mesurer, seul le client ou l'artisan la donne. */
  mesure: SourceMesure | null
}

const q = (cle: string, libelle: string, unite: Unite, question: string, mesure: SourceMesure | null): Quantite => ({
  cle,
  libelle,
  unite,
  question,
  mesure,
})

export const QUANTITES: Record<string, Quantite> = Object.fromEntries(
  [
    // Toit
    q('toit_surface', 'Surface du toit', 'm2', 'Quelle surface fait le toit, à peu près ?', 'toit'),
    q('toit_pente', 'Pente du toit', 'pct', 'Le toit est-il plat, peu pentu ou très pentu ?', 'toit'),
    q('toit_pans', 'Nombre de pans', 'u', 'Combien de pans a le toit : deux, quatre ?', 'toit'),
    q('egouts', 'Longueur de gouttières', 'ml', 'Combien de mètres de gouttières ?', 'toit'),
    q('faitage', 'Longueur de faîtage', 'ml', 'Quelle longueur fait le faîtage, le haut du toit ?', 'toit'),
    q('rives', 'Longueur de rives', 'ml', 'Et les rives, sur les côtés du toit ?', 'toit'),
    q('fenetres_toit', 'Fenêtres de toit', 'u', 'Combien de fenêtres de toit (Velux) ?', 'photo'),
    q('cheminees', 'Cheminées', 'u', 'Combien de cheminées sur le toit ?', 'photo'),
    // Murs
    q('facades_total', 'Surface des façades', 'm2', 'Combien de façades à refaire, et quelle surface ?', 'facades'),
    q('hauteur_murs', 'Hauteur des murs', 'm', 'Combien d’étages ? Quelle hauteur jusqu’à la gouttière ?', 'hauteurs'),
    q('ouvertures', 'Fenêtres et portes', 'u', 'Combien de fenêtres et de portes sur ces façades ?', null),
    // Terrain
    q('cloture_longueur', 'Longueur de clôture', 'ml', 'Quelle longueur de clôture, et sur quels côtés ?', 'parcelle'),
    q('cloture_hauteur', 'Hauteur de clôture', 'm', 'Quelle hauteur souhaitez-vous ?', null),
    q('portail', 'Portail', 'oui_non', 'Faut-il un portail ou un portillon ?', null),
    q('portail_largeur', 'Largeur du portail', 'm', 'Quelle largeur fait l’entrée ?', null),
    q('parcelle_surface', 'Surface du terrain', 'm2', 'Quelle surface fait le terrain ?', 'parcelle'),
    q('terrasse_surface', 'Surface de terrasse', 'm2', 'Quelle surface de terrasse, à peu près ?', null),
    q('jardin_surface', 'Surface du jardin', 'm2', 'Quelle surface de jardin à aménager ?', 'parcelle'),
    // Piscine
    q('piscine_longueur', 'Longueur du bassin', 'm', 'Quelle longueur fait le bassin ?', 'photo'),
    q('piscine_largeur', 'Largeur du bassin', 'm', 'Et sa largeur ?', 'photo'),
    q('plages_surface', 'Surface des plages', 'm2', 'Quelle surface de plage autour du bassin ?', null),
  ].map((x) => [x.cle, x]),
)

const TOIT = ['toit_surface', 'toit_pente', 'toit_pans', 'egouts', 'faitage', 'rives', 'fenetres_toit', 'cheminees']
const FACADES = ['facades_total', 'hauteur_murs', 'ouvertures']

/** Les quantités de chaque métier, dans l'ordre où on les demande. */
export const PAR_METIER: Record<string, string[]> = {
  Couverture: TOIT,
  Toiture: TOIT,
  'Solaire / Photovoltaïque': ['toit_surface', 'toit_pente', 'toit_pans'],
  'Façade / Ravalement': FACADES,
  Isolation: [...FACADES, 'toit_surface'],
  Peinture: FACADES,
  Maçonnerie: FACADES,
  Clôture: ['cloture_longueur', 'cloture_hauteur', 'portail', 'portail_largeur', 'parcelle_surface'],
  Portail: ['portail_largeur', 'cloture_longueur'],
  Terrasse: ['terrasse_surface'],
  Paysagisme: ['jardin_surface', 'parcelle_surface', 'cloture_longueur'],
  Piscine: ['piscine_longueur', 'piscine_largeur', 'plages_surface', 'parcelle_surface'],
}

/** Les quantités d'un chantier, pour ses métiers ; celles d'un métier inconnu : aucune. */
export function quantitesDuChantier(metiers: (string | null | undefined)[]): Quantite[] {
  const cles = new Set<string>()
  for (const m of metiers) for (const c of PAR_METIER[m ?? ''] ?? []) cles.add(c)
  return [...cles].map((c) => QUANTITES[c])
}

/**
 * L'écart toléré entre ce que dit le client et ce qu'on mesure.
 *
 * Un client arrondit : « à peu près cent mètres carrés ». Au-delà de ces
 * marges, l'écart n'est plus un arrondi mais un malentendu — autre façade,
 * autre côté du terrain — qu'il faut lever avant de chiffrer.
 */
export const TOLERANCE: Record<Unite, { relative?: number; absolue?: number }> = {
  m2: { relative: 0.12 },
  ml: { relative: 0.1 },
  m: { absolue: 0.5 },
  pct: { absolue: 5 },
  u: { absolue: 0 },
  oui_non: { absolue: 0 },
}

/** Le dit et le mesuré concordent-ils ? Même règle que `verifier_metrage` en base. */
export function concorde(unite: Unite, declaree: number, mesuree: number): boolean {
  const t = TOLERANCE[unite]
  const ecart = Math.abs(declaree - mesuree)
  if (t.relative != null) return mesuree > 0 && ecart / mesuree <= t.relative
  return ecart <= (t.absolue ?? 0)
}
