import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/** Bloc renvoyé par la RPC `stats_agence()` (migration 0071). */
export interface StatsAgence {
  projets_total: number
  projets_actifs: number
  en_attente: number
  a_rappeler: number
  non_attribues: number
  devis_deposes: number
  devis_montant_total: number
  devis_montant_median: number
  devis_signes: number
  perdus: number
  morts: number
  termines: number
  conversion_tranches: number
  conversion_gagnes: number
  ca_signe: number
  commission_acquise: number
  commission_encaissee: number
  commission_a_encaisser: number
  commission_potentielle: number
  artisans_total: number
  artisans_actifs: number
}

export function useStatsAgence() {
  return useQuery({
    queryKey: ['stats-agence'],
    queryFn: async (): Promise<StatsAgence> => {
      const { data, error } = await supabase.rpc('stats_agence')
      if (error) throw error
      return data as StatsAgence
    },
  })
}
