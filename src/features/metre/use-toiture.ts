import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'
import type { Toiture } from './toiture'

// Les types et les règles pures vivent dans `toiture.ts`, que le banc de
// justesse importe sans le client Supabase.
export * from './toiture'

export function useToiture(
  token: string | undefined,
  cleabs: string | null,
  contour: Point[] | null,
) {
  return useQuery({
    // Une valeur sérialisée reste stable entre rendus, mais distingue bien
    // deux contours ayant le même premier sommet et deux sessions d'accès.
    queryKey: ['toiture', cleabs, JSON.stringify(contour), token ?? null],
    enabled: !!token && !!contour && contour.length >= 3,
    // Un toit ne bouge pas, et le serveur garde déjà la mesure.
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    queryFn: async ({ signal }): Promise<Toiture | null> => {
      const { data, error } = await supabase.functions.invoke('toiture-lidar', {
        body: { token, cleabs, contour },
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
      })
      if (error) throw error
      if (!data || data.ok !== true || data.error) throw new Error('La mesure de toiture n’a pas pu être chargée. Réessayez.')
      return data as Toiture
    },
  })
}
