import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Artisan, Contrat } from '@/types/database'

const TABLE = 'contrats'

/** Dernier contrat d'engagement d'un artisan (ou null s'il n'y en a pas). */
export function useContratArtisan(artisanId: string | undefined) {
  return useQuery({
    queryKey: ['contrats', 'artisan', artisanId],
    enabled: !!artisanId,
    queryFn: async (): Promise<Contrat | null> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('artisan_id', artisanId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/**
 * Génère (ou récupère) le contrat d'engagement de l'artisan.
 * S'appuie sur la fonction SQL idempotente `ensure_engagement_contrat`
 * (un seul contrat par artisan, texte par défaut côté base).
 */
export function useCreateContrat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (artisan: Artisan): Promise<Contrat> => {
      const { data, error } = await supabase.rpc('ensure_engagement_contrat', {
        p_artisan_id: artisan.id,
      })
      if (error) throw error
      return data as Contrat
    },
    onSuccess: (c) =>
      qc.invalidateQueries({ queryKey: ['contrats', 'artisan', c.artisan_id] }),
  })
}
