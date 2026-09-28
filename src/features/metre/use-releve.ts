import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'
import type { Releve } from './releve'

export * from './releve'

/** Ce que rend la fonction `releve-lidar`. */
export interface ReponseReleve {
  ok?: boolean
  trouve?: boolean
  id?: string
  statut?: 'en_cours' | 'fait' | 'hors_couverture' | 'introuvable' | 'echec'
  motif?: string | null
  confiance?: 'haute' | 'moyenne' | 'basse' | null
  releve?: Releve | null
  fait_le?: string | null
}

/** L'IGN met 20 à 75 s à servir une maison : on redemande toutes les 4 s, trois minutes au plus. */
const INTERVALLE_MS = 4000
const ESSAIS_MAX = 45

/**
 * Le relevé LiDAR d'une maison : lu dans le cache du serveur, ou lancé. Tant
 * qu'il est « en cours », l'écran garde ses chiffres d'avant et redemande.
 */
export function useReleve(token: string | undefined, cleabs: string | null, point: Point | null) {
  return useQuery({
    queryKey: ['releve', cleabs],
    enabled: !!token && !!cleabs,
    // Un relevé fait ne bouge pas ; le serveur le garde.
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.statut === 'en_cours' && q.state.dataUpdateCount < ESSAIS_MAX ? INTERVALLE_MS : false,
    queryFn: async (): Promise<ReponseReleve> => {
      const { data, error } = await supabase.functions.invoke('releve-lidar', {
        body: { token, cleabs, point },
      })
      if (error) throw error
      return data as ReponseReleve
    },
  })
}
