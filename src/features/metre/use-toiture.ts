import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'

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
}): { pente: number; source: 'saisie' | 'lidar' | 'photogrammetrie' | 'altitudes' | null } {
  if (p.saisie != null) return { pente: p.saisie, source: 'saisie' }

  const m = p.mesuree
  if (m?.couvert && m.fiable && m.pente != null) {
    return {
      pente: Math.round(m.pente),
      source: m.source?.includes('LiDAR') ? 'lidar' : 'photogrammetrie',
    }
  }

  if (p.deduite != null) return { pente: p.deduite, source: 'altitudes' }
  return { pente: 0, source: null }
}

/** « nord-ouest » et « sud-est » → « nord-ouest et sud-est ». */
export function versantsLisibles(v: Toiture['versants']): string | null {
  if (!v || v.length === 0) return null
  const deux = v.slice(0, 2).map((x) => x.orientation)
  return deux.length === 2 ? `${deux[0]} et ${deux[1]}` : deux[0]
}
