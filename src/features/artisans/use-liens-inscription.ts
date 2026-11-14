import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export type LienInscription = { token: string; canal: string; taux: 10 | 15 | 20 }

export function useLiensInscription(enabled: boolean) {
  return useQuery({
    queryKey: ['liens-inscription-agence'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LienInscription[]> => {
      const { data, error } = await supabase.rpc('liens_inscription_agence')
      if (error) throw error
      if (!Array.isArray(data) || data.some((l) => !l || !/^[a-f0-9]{64}$/.test(l.token) || ![10, 15, 20].includes(l.taux))) {
        throw new Error('Liens d’inscription indisponibles')
      }
      return data as LienInscription[]
    },
  })
}
