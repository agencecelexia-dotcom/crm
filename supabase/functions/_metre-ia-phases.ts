// Les ÉTAPES de « Mesurer avec l'IA », dans l'ordre où l'utilisateur les vit :
// 1. les photos se prennent, 2. l'IA les analyse (et écarte les mauvaises),
// 3. elle mesure, 4. la 3D se construit — et apparaît. Partagé par la fonction
// (qui les écrit) et l'écran (qui les montre, y compris celles qui restent à faire).

export interface PhaseIA {
  numero: 1 | 2 | 3 | 4
  titre: string
  /** Ce qu'on dit à l'utilisateur pendant que la phase tourne. */
  attente: string
}

export const PHASES_IA: PhaseIA[] = [
  { numero: 1, titre: 'Prise des photos', attente: 'Les photos se prennent : points laser, photo aérienne, vues en 3D, photos de la rue. Patientez…' },
  { numero: 2, titre: 'Analyse des photos', attente: 'L’IA regarde chaque photo : celles qui ne montrent pas la maison sont écartées.' },
  { numero: 3, titre: 'Mesures', attente: 'L’IA trace la maison et le laser mesure dans ses tracés : toit, pans, murs, terrasses, hauteurs.' },
  { numero: 4, titre: 'Construction de la 3D', attente: 'La maison se construit en 3D à partir des mesures.' },
]

export interface EtapePrevue {
  cle: string
  libelle: string
  phase: 1 | 2 | 3 | 4
}

/** Toutes les étapes d'une lecture, dans l'ordre. */
export const ETAPES_PREVUES: EtapePrevue[] = [
  { cle: 'releve', libelle: 'Points du laser (LiDAR de l’IGN)', phase: 1 },
  { cle: 'images', libelle: 'Photo aérienne et vues en 3D', phase: 1 },
  { cle: 'rue', libelle: 'Photos de la rue', phase: 1 },
  { cle: 'tri', libelle: 'Tri des photos de la rue', phase: 2 },
  { cle: 'scene', libelle: 'Lecture de la scène : volumes, terrasses, escaliers', phase: 2 },
  { cle: 'traces', libelle: 'L’IA trace la maison, le laser mesure', phase: 3 },
  { cle: 'releve_ia', libelle: 'Pans, murs et hauteurs', phase: 3 },
  { cle: 'controle', libelle: 'Contrôle par les mesures', phase: 4 },
  { cle: 'modele', libelle: 'Modèle 3D', phase: 4 },
]

/** Les raisons pour lesquelles une photo de la rue est écartée, dites à l'utilisateur. */
export const RAISONS_PHOTO: Record<string, string> = {
  facade_invisible: 'la façade n’y est pas visible',
  autre_batiment: 'elle montre un autre bâtiment',
  facade_partielle: 'la façade n’y est visible qu’en partie',
  cadre_invalide: 'la façade n’y est pas lisible',
  lecture_impossible: 'l’IA n’a pas pu la lire',
}
