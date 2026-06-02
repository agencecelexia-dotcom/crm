import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Artisan, Contrat } from '@/types/database'
import { genererContenuContrat } from './contrat-template'

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

/** Génère un contrat d'engagement (snapshot du texte + token de signature). */
export function useCreateContrat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (artisan: Artisan): Promise<Contrat> => {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ artisan_id: artisan.id, contenu: genererContenuContrat(artisan) })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (c) =>
      qc.invalidateQueries({ queryKey: ['contrats', 'artisan', c.artisan_id] }),
  })
}
