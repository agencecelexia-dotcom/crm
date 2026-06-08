import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Suivi } from '@/types/database'

// Suivi d'un projet (statuts déclarés par l'artisan + notes agence/artisan).

export function useSuivis(projetId: string | undefined) {
  return useQuery({
    queryKey: ['suivis', projetId],
    enabled: !!projetId,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Suivi[]> => {
      const { data, error } = await supabase
        .from('suivis')
        .select('auteur, type, statut:statut_artisan, message, created_at')
        .eq('projet_id', projetId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Suivi[]
    },
  })
}

export function useAddSuiviAgence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projetId, message }: { projetId: string; message: string }) => {
      const { error } = await supabase
        .from('suivis')
        .insert({ projet_id: projetId, auteur: 'agence', type: 'note', message })
      if (error) throw error
    },
    onSuccess: (_d, { projetId }) =>
      qc.invalidateQueries({ queryKey: ['suivis', projetId] }),
  })
}
