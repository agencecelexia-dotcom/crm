// Les règles du toit, sans réseau ni React : l'écran, la pré-mesure, les
// tests et le banc de justesse lisent les mêmes. Le hook qui interroge le
// serveur est dans `src/features/metre/use-toiture.ts`.

import type { Facade } from './_geometrie.ts'

/**
 * La pente d'un toit, mesurée dans les données d'altitude de l'IGN.
 *
 * POURQUOI ELLE REMPLACE CE QU'ON AVAIT
 *
 * La pente venait jusqu'ici des altitudes de la BD TOPO : faîtage moins
 * gouttière, sur la demi-largeur du bâtiment. La précision altimétrique d'un
 * mètre y laissait ±27 à ±61 POINTS. Autant dire rien, et pourtant l'écran
 * l'affichait comme un chiffre.
 *
 * Ici, la pente est LUE dans une grille d'altitudes à cinquante centimètres,
 * pixel par pixel. Sur des maisons réelles : ±2 à ±10 points, et les versants
 * ressortent par paires opposées — ce que donne un toit à deux pans.
 *
 * CE QU'IL FAUT LIRE AVEC
 *
 * `source` dit d'où vient le chiffre. Le LiDAR couvre 90 % de la population,
 * pas le territoire : Lille est un trou de 22 km de côté, et l'on y retombe sur
 * la photogrammétrie, moins précise. Le chiffre ne veut pas dire la même chose
 * dans les deux cas, donc on montre toujours sa provenance.
 *
 * `fiable` dit si le toit a un pan dominant. Sur un îlot urbain, les huit
 * orientations se valent et il n'y a pas de pente à donner : l'écran doit le
 * dire plutôt que servir un nombre.
 */
export interface Toiture {
  ok: boolean
  cache?: boolean
  /** false = hors couverture, ou trop peu de toit pour conclure. */
  couvert: boolean
  /** Vrai quand le toit a deux versants nets et une dispersion tenable. */
  fiable?: boolean
  motif?: string | null
  pente?: number | null
  /** Demi-écart interquartile des pixels, en points de pourcentage. */
  incertitude?: number | null
  pixels?: number | null
  versants?: { orientation: string; part: number }[]
  source?: string | null
  mesure_le?: string | null
  /** Un profil par arête du contour — seulement quand le LiDAR couvre. */
  murs?: MurMesure[] | null
  /** Bas du toit, au-dessus du sol : le haut des murs sous gouttière. */
  hauteur_gouttiere?: number | null
  /** Point le plus haut du toit, au-dessus du sol. */
  hauteur_faitage?: number | null
  /** Surface vraie ÷ surface au sol, pan par pan (absent des mesures anciennes). */
  facteur?: number | null
  /** Part des pixels quasi plats (pente ≤ 10 %). */
  part_plate?: number | null
  /** Les pans d'au moins 8 % du toit : orientation, part, pente médiane et dispersion. */
  pans?: PanMesure[] | null
}

/** Un pan tel que le relevé le rend. */
export interface PanMesure {
  orientation: string
  part: number
  pente: number
  /** Demi-écart interquartile des pentes du pan. */
  incertitude: number
}

/** Ce que le relevé dit d'une arête du contour. */
export interface MurMesure {
  i: number
  longueur: number
  /** Surface brute du mur, ouvertures non déduites. */
  surface: number
  hauteur_moyenne: number
  hauteur_min: number
  hauteur_max: number
  /** Part des points du mur où le toit a été trouvé. */
  valide: number
  /**
   * Repère LiDAR (hauteur relevée à 1,25 m hors du mur). PEU FIABLE : un grand
   * débord, un arbre le déclenchent. Les murs accolés se lisent désormais dans
   * la géométrie des bâtiments voisins (`longueurAccolee`, geometrie.ts).
   */
  accole: boolean
}

/** Une façade mesurée : la somme de ses pans, et ce qu'on peut en dire. */
export interface FacadeMesuree {
  /** Surface brute, ouvertures non déduites. */
  surface: number
  hauteurMoyenne: number
  hauteurMin: number
  hauteurMax: number
}

/**
 * La façade telle que le LiDAR l'a relevée, ou null si on ne peut pas s'y fier.
 *
 * Une façade est faite de pans, et un pan d'une ou plusieurs arêtes du
 * contour ; le relevé rend un profil par arête. On additionne.
 *
 * ON REFUSE PLUTÔT QUE DE COMPLÉTER. Si une seule arête manque, ou si le toit
 * n'a été trouvé que sur une partie du mur (moins de 80 % de ses points), la
 * surface serait sous-estimée sans que rien ne le montre. On renvoie null, et
 * l'écran demande la hauteur.
 */
export function mesureFacade(f: Facade, t: Toiture | null | undefined): FacadeMesuree | null {
  const parArete = new Map((t?.murs ?? []).map((m) => [m.i, m]))
  if (parArete.size === 0) return null

  const releves: MurMesure[] = []
  for (const pan of f.pans) {
    for (const i of pan.aretes) {
      const m = parArete.get(i)
      // Le relevé et \`murs()\` écartent tous deux les arêtes de moins de 30 cm :
      // une arête absente ici est une anomalie, pas un détail à ignorer.
      if (!m) return null
      releves.push(m)
    }
  }
  if (releves.length === 0) return null

  const longueur = releves.reduce((s, m) => s + m.longueur, 0)
  const valide = releves.reduce((s, m) => s + m.valide * m.longueur, 0) / longueur
  if (valide < 0.8) return null

  const surface = releves.reduce((s, m) => s + m.surface, 0)
  return {
    surface,
    hauteurMoyenne: surface / longueur,
    hauteurMin: Math.min(...releves.map((m) => m.hauteur_min)),
    hauteurMax: Math.max(...releves.map((m) => m.hauteur_max)),
  }
}

/**
 * La pente à afficher, et d'où elle vient.
 *
 * L'ORDRE N'EST PAS ARBITRAIRE. L'artisan passe avant tout : il est sur place.
 * Vient ensuite la pente MESURÉE dans les altitudes — mais seulement si elle est
 * fiable : sur un îlot urbain sans pan dominant, la médiane des pixels est du
 * bruit, et la servir serait exactement le défaut qu'on vient de corriger. En
 * dernier recours la pente DÉDUITE de deux altitudes de la BD TOPO, qui vaut
 * ±27 à ±61 points et doit être annoncée comme telle.
 *
 * Extrait du composant pour être vérifiable : c'est la règle qui décide quel
 * chiffre l'artisan recopie dans son devis.
 */
export function penteRetenue(p: {
  saisie: number | null
  mesuree: Toiture | null | undefined
  deduite: number | null
}): {
  /** La pente retenue, ou null quand personne ne la connaît : il faut la demander. */
  pente: number | null
  source: 'saisie' | 'lidar' | 'photogrammetrie' | null
  /**
   * La pente DÉDUITE de deux altitudes de la BD TOPO, proposée sans être
   * retenue. Elle vaut ±27 à ±61 points : la présenter comme la pente du toit
   * reviendrait à afficher un chiffre qu'on ne sait pas défendre. L'artisan
   * peut la reprendre d'un geste — elle devient alors SA saisie.
   */
  suggestion: number | null
} {
  const suggestion = p.deduite
  if (p.saisie != null) return { pente: p.saisie, source: 'saisie', suggestion }

  const m = p.mesuree
  const mesuree = penteMesureeDe(m)
  if (mesuree != null) {
    return { pente: mesuree, source: m?.source?.includes('LiDAR') ? 'lidar' : 'photogrammetrie', suggestion }
  }

  // Ni mesure fiable, ni choix de l'artisan : la pente est INCONNUE. Elle
  // valait 0 jusqu'ici, et l'écran allumait « plate » et calculait un toit plat
  // que personne n'avait choisi.
  return { pente: null, source: null, suggestion }
}

/**
 * La pente MESURÉE d'un toit, ou null s'il ne se lit pas.
 *
 * Une mesure récente porte ses pans : elle se lit pan par pan
 * (`lectureParPans`). Une mesure plus ancienne, sans pans, garde la règle des
 * deux versants dominants — le toit sera relu pan par pan à la prochaine
 * mesure.
 */
export function penteMesureeDe(m: Toiture | null | undefined): number | null {
  if (!m?.couvert) return null
  if (m.pans && m.facteur != null) return lectureParPans(m).pente
  return m.fiable && m.pente != null ? Math.round(m.pente) : null
}

/**
 * Le toit en quelques mots : « quatre pans à 31 % », « deux pans, 58 % et
 * 38 % », « un pan à 27 %, une partie plate ». Null sans lecture pan par pan.
 */
export function resumePans(m: Toiture | null | undefined): string | null {
  const l = lectureParPans(m)
  if (!l.fiable) return null
  if (l.plat) return 'toit plat'
  const pans = l.pans
  if (!pans.length) return null
  const NOMBRES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit']
  const n = pans.length
  const nombre = `${NOMBRES[n] ?? n} pan${n > 1 ? 's' : ''}`
  const pentes = pans.map((p) => p.pente)
  const memePente = Math.max(...pentes) - Math.min(...pentes) <= 6
  const plat = (m?.part_plate ?? 0) >= 0.1 ? ', une partie plate' : ''
  if (memePente) return `${nombre} à ${Math.round(pentes.reduce((a, b) => a + b, 0) / n)} %${plat}`
  const liste = pentes.slice(0, 3).map((x) => `${x} %`)
  return `${nombre}, ${liste.length > 1 ? `${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}` : liste[0]}${plat}`
}

/**
 * La part de toiture que représente un versant.
 *
 * Les parts renvoyées sont celles des PIXELS EN PENTE, et l'on ne garde que les
 * versants au-dessus de dix pour cent : elles ne somment donc pas à un. On les
 * renormalise sur ce qui a été retenu, sans quoi un versant à 53 % d'un total
 * de 83 % serait annoncé pour la moitié du toit alors qu'il en fait les deux
 * tiers.
 *
 * C'est une PROPORTION DE SURFACE PROJETÉE, exacte seulement si les versants
 * ont la même pente — ce qu'ils ont sur un toit courant. D'où le « environ »
 * à l'écran.
 */
export function partsNormalisees(t: Toiture | null | undefined): { orientation: string; part: number }[] {
  // SI LA MESURE N'EST PAS FIABLE, IL N'Y A PAS DE VERSANTS À PROPOSER. L'écran
  // dirait autrement « ce toit est trop découpé pour qu'une pente unique ait un
  // sens », puis offrirait dans la foulée « nord-est · 47 m² » — un chiffre
  // calculé sur la pente qu'il vient de refuser.
  if (t?.couvert && t.pans && t.facteur != null) {
    // Pan par pan, la part de chacun dans la surface VRAIE : un pan raide pèse
    // plus que sa projection au sol. La partie plate reste au dénominateur —
    // choisir un pan n'en rend pas la part plate.
    const l = lectureParPans(t)
    if (!l.fiable || l.plat) return []
    const poids = l.pans.map((p) => p.part * Math.sqrt(1 + (p.pente / 100) ** 2))
    const total = (t.part_plate ?? 0) + poids.reduce((s, x) => s + x, 0)
    return total > 0 ? l.pans.map((p, i) => ({ orientation: p.orientation, part: poids[i] / total })) : []
  }
  if (!t?.couvert || !t.fiable) return []
  const v = t.versants
  if (!v || v.length === 0) return []
  const total = v.reduce((s, x) => s + x.part, 0)
  if (total <= 0) return []
  return v.map((x) => ({ orientation: x.orientation, part: x.part / total }))
}

/** « nord-ouest » et « sud-est » → « nord-ouest et sud-est ». */
export function versantsLisibles(v: Toiture['versants']): string | null {
  if (!v || v.length === 0) return null
  const deux = v.slice(0, 2).map((x) => x.orientation)
  return deux.length === 2 ? `${deux[0]} et ${deux[1]}` : deux[0]
}

/** Un pan plus raide n'est pas un toit : un mur, un ressaut (voir `_calcul-toit.ts`). */
const PAN_MAX_PCT = 150
/** Les pixels d'un pan NET s'accordent à dix points près — au LiDAR, à 50 cm. */
const PAN_NET_PCT = 10
/** Part du toit qui doit être lisible — plate, ou en pans nets — pour qu'on la chiffre. */
const PART_LISIBLE = 0.6

/**
 * Le toit lu PAN PAR PAN.
 *
 * La règle précédente exigeait deux versants dominants : elle refusait les
 * toits à quatre pans (à Saint-Aygulf, 31 % ± 2 sur sept orientations,
 * déclaré « trop découpé ») et les toits plats, dont les pixels n'ont pas
 * d'orientation. Ici, un toit se chiffre dès que 60 % de ses pixels sont
 * plats ou dans des pans NETS — des pans dont les pixels s'accordent à dix
 * points près. Le toit vraiment découpé (Strasbourg : ±18 à ±217 selon le
 * pan) reste à saisir.
 *
 * La pente retenue est ÉQUIVALENTE : celle qui, appliquée à tout le toit,
 * donne la même surface que la somme des pans. C'est ce que la base
 * recalcule à l'enregistrement : enregistré = affiché.
 *
 * La photogrammétrie (grille d'un mètre) garde sa règle, validée contre le
 * LiDAR : ses pans sont trop bruités pour ce critère.
 */
export function lectureParPans(t: Toiture | null | undefined): {
  fiable: boolean
  /** Pente équivalente, en %, ou null quand le toit ne se lit pas. */
  pente: number | null
  plat: boolean
  pans: PanMesure[]
} {
  const rien = { fiable: false, pente: null, plat: false, pans: [] }
  if (!t?.couvert || t.facteur == null || !t.pans) return rien
  const lidar = !!t.source?.includes('LiDAR')
  const nets = t.pans.filter((p) => p.pente <= PAN_MAX_PCT && p.incertitude <= PAN_NET_PCT)
  const lisible = (t.part_plate ?? 0) + nets.reduce((s, p) => s + p.part, 0)
  const fiable = lidar ? lisible >= PART_LISIBLE : !!t.fiable
  if (!fiable) return { ...rien, pans: t.pans }
  return {
    fiable,
    // La photogrammétrie garde sa médiane : à un mètre, ses pans sont trop
    // bruités pour un facteur de surface.
    pente: lidar || t.pente == null ? Math.round(Math.sqrt(Math.max(0, t.facteur ** 2 - 1)) * 100) : Math.round(t.pente),
    plat: (t.part_plate ?? 0) >= PART_LISIBLE,
    pans: t.pans.filter((p) => p.pente <= PAN_MAX_PCT),
  }
}
