import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export interface StatArtisan {
  id: string
  nom: string | null
  gagnes: number
  ca_signe: number
  commission: number
  en_cours: number
  perdus: number
  taux: number | null // % de signature (gagnés / (gagnés + perdus))
  delai_h: number | null // délai moyen de 1ère réponse (heures)
}

/** Stats de performance par artisan (calculées en base). */
export function useStatsArtisans() {
  return useQuery({
    queryKey: ['stats-artisans'],
    queryFn: async (): Promise<StatArtisan[]> => {
      const { data, error } = await supabase.rpc('stats_artisans')
      if (error) throw error
      return (data as StatArtisan[]) ?? []
    },
  })
}
