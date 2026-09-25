// Les quantités qu'on peut noter au téléphone, et leur unité — la même liste
// que `src/features/metre/catalogue-metrage.ts` (un test unitaire vérifie
// qu'elles ne divergent pas). La fonction d'extraction contraint Claude à ces
// clés : une quantité inventée n'aurait nulle part où aller.

export const CLES_METRAGE: Record<string, 'm2' | 'ml' | 'm' | 'pct' | 'u' | 'oui_non'> = {
  toit_surface: 'm2',
  toit_pente: 'pct',
  toit_pans: 'u',
  egouts: 'ml',
  faitage: 'ml',
  rives: 'ml',
  fenetres_toit: 'u',
  cheminees: 'u',
  facades_total: 'm2',
  hauteur_murs: 'm',
  ouvertures: 'u',
  cloture_longueur: 'ml',
  cloture_hauteur: 'm',
  portail: 'oui_non',
  portail_largeur: 'm',
  parcelle_surface: 'm2',
  terrasse_surface: 'm2',
  jardin_surface: 'm2',
  piscine_longueur: 'm',
  piscine_largeur: 'm',
  plages_surface: 'm2',
}

const TOIT = ['toit_surface', 'toit_pente', 'toit_pans', 'egouts', 'faitage', 'rives', 'fenetres_toit', 'cheminees']
const FACADES = ['facades_total', 'hauteur_murs', 'ouvertures']

/**
 * Les quantités de chaque métier, dans l'ordre où on les demande. La
 * pré-mesure n'écrit que celles-là : les façades d'un immeuble entier ne
 * disent rien à qui pose un parquet au troisième étage.
 */
export const METRAGE_PAR_METIER: Record<string, string[]> = {
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

/** Les quantités utiles à un chantier, pour ses métiers. */
export function clesDuChantier(metiers: (string | null | undefined)[]): Set<string> {
  const cles = new Set<string>()
  for (const m of metiers) for (const c of METRAGE_PAR_METIER[m ?? ''] ?? []) cles.add(c)
  return cles
}
