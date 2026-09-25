import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Facade, Point } from './geometrie'

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
  /** Un autre volume touche ce mur sur la majeure partie de sa longueur. */
  accole: boolean
}

/** Une façade mesurée : la somme de ses pans, et ce qu'on peut en dire. */
export interface FacadeMesuree {
  /** Surface brute, ouvertures non déduites. */
  surface: number
  hauteurMoyenne: number
  hauteurMin: number
  hauteurMax: number
  /** Longueur de mur accolée à un autre volume, en mètres. */
  longueurAccolee: number
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
    longueurAccolee: releves.filter((m) => m.accole).reduce((s, m) => s + m.longueur, 0),
  }
}

export function useToiture(
  token: string | undefined,
  cleabs: string | null,
  contour: Point[] | null,
) {
  return useQuery({
    // Le contour n'entre pas dans la clé : il change d'identité à chaque rendu
    // alors que le bâtiment est le même. C'est ce piège qui avait déclenché des
    // centaines d'appels au WFS par ouverture de carte.
    queryKey: ['toiture', cleabs ?? contour?.[0]?.join(',')],
    enabled: !!token && !!contour && contour.length >= 3,
    // Un toit ne bouge pas, et le serveur garde déjà la mesure.
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    queryFn: async (): Promise<Toiture | null> => {
      const { data, error } = await supabase.functions.invoke('toiture-lidar', {
        body: { token, cleabs, contour },
      })
      if (error) throw error
      return data as Toiture
    },
  })
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
  if (m?.couvert && m.fiable && m.pente != null) {
    return {
      pente: Math.round(m.pente),
      source: m.source?.includes('LiDAR') ? 'lidar' : 'photogrammetrie',
      suggestion,
    }
  }

  // Ni mesure fiable, ni choix de l'artisan : la pente est INCONNUE. Elle
  // valait 0 jusqu'ici, et l'écran allumait « plate » et calculait un toit plat
  // que personne n'avait choisi.
  return { pente: null, source: null, suggestion }
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
