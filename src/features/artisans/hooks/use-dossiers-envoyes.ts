import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

const PAGE = 1000

/**
 * Le nombre de dossiers ENVOYÉS à chaque artisan : toutes ses affectations,
 * y compris celles qu'il a perdues ou qu'on lui a retirées — c'est ce qu'on lui
 * a confié depuis le début, pas ce qui lui reste en cours (`stats_artisans`).
 *
 * Lu par pages : l'API plafonne une réponse à 1 000 lignes, et la table grossit.
 */
export function useDossiersEnvoyes() {
  return useQuery({
    queryKey: ['dossiers-envoyes'],
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const parArtisan = new Map<string, number>()
      for (let de = 0; ; de += PAGE) {
        const { data, error } = await supabase
          .from('affectations')
          .select('artisan_id')
          .order('id')
          .range(de, de + PAGE - 1)
        if (error) throw error
        for (const l of data ?? []) {
          if (l.artisan_id) parArtisan.set(l.artisan_id, (parArtisan.get(l.artisan_id) ?? 0) + 1)
        }
        if ((data?.length ?? 0) < PAGE) break
      }
      return parArtisan
    },
  })
}
