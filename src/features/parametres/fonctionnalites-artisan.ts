import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { VueEspace } from '@/features/contrats/ecrans-espace'

export type FonctionnalitesArtisan = Record<VueEspace, boolean>
export const FONCTIONNALITES_PAR_DEFAUT: FonctionnalitesArtisan = {
  chantiers: true, devis: false, metres: false, commissions: true, entreprise: true, aide: true,
}

export function useFonctionnalitesArtisan() {
  return useQuery({
    queryKey: ['fonctionnalites-artisan'],
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<FonctionnalitesArtisan> => {
      const { data, error } = await supabase.rpc('fonctionnalites_espace_artisan')
      if (error) throw error
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Réglages indisponibles')
      const result = { ...FONCTIONNALITES_PAR_DEFAUT }
      for (const cle of Object.keys(result) as VueEspace[]) {
        result[cle] = (data as Record<string, unknown>)[cle] === true
      }
      result.chantiers = true
      return result
    },
  })
}

export function useModifierFonctionnaliteArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ cle, active }: { cle: Exclude<VueEspace, 'chantiers'>; active: boolean }) => {
      const { data, error } = await supabase.from('fonctionnalites_artisan')
        .update({ active, updated_at: new Date().toISOString() }).eq('cle', cle).select('cle').single()
      if (error) throw error
      if (!data) throw new Error('Réglage non enregistré')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fonctionnalites-artisan'] }),
  })
}
