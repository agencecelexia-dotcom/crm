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
