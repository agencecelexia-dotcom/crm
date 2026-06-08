import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

// Réglages applicatifs (table app_settings, clé/valeur). Utilisé pour la
// signature de l'apporteur, partagée par les 2 associés sur tous les appareils.

export const CLE_SIGNATURE_APPORTEUR = 'apporteur_signature'

/** Lit une valeur de réglage (null si absente). */
export function useParametre(cle: string) {
  return useQuery({
    queryKey: ['parametre', cle],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('valeur')
        .eq('cle', cle)
        .maybeSingle()
      if (error) throw error
      return data?.valeur ?? null
    },
  })
}

/** Enregistre (upsert) une valeur de réglage. */
export function useSetParametre() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ cle, valeur }: { cle: string; valeur: string | null }) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ cle, valeur, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: (_d, { cle }) => qc.invalidateQueries({ queryKey: ['parametre', cle] }),
  })
}
