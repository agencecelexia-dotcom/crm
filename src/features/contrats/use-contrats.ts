import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Contrat } from '@/types/database'

const TABLE = 'contrats'

/** Dernier contrat d'engagement d'un artisan (ou null s'il n'y en a pas). */
export function useContratArtisan(artisanId: string | undefined) {
  return useQuery({
    queryKey: ['contrats', 'artisan', artisanId],
    enabled: !!artisanId,
    queryFn: async (): Promise<Contrat | null> => {
      // On lit le contrat d'origine (le plus ancien) — le même que la page mission
      // (get_mission_by_token) — pour qu'un artisan déjà signé ne re-signe jamais.
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('artisan_id', artisanId!)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/**
 * Génère le contrat d'engagement avec le contenu rempli (variables substituées).
 * Le contenu est figé en snapshot ; un token de signature est créé par défaut.
 */
export function useGenererContrat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      artisanId,
      contenu,
    }: {
      artisanId: string
      contenu: string
    }): Promise<Contrat> => {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ artisan_id: artisanId, contenu })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (c) =>
      qc.invalidateQueries({ queryKey: ['contrats', 'artisan', c.artisan_id] }),
  })
}
