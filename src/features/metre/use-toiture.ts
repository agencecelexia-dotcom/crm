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
    // Le contour n'entre pas dans la clé : il change d'identité à chaque rendu
    // alors que le bâtiment est le même. C'est ce piège qui avait déclenché des
    // centaines d'appels au WFS par ouverture de carte.
    queryKey: ['toiture', cleabs ?? contour?.[0]?.join(',')],
    enabled: !!token && !!contour && contour.length >= 3,
    // Un toit ne bouge pas, et le serveur garde déjà la mesure.
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    queryFn: async (): Promise<Toiture | null> => {
      const { data, error } = await supabase.functions.invoke('toiture-lidar', {
        body: { token, cleabs, contour },
      })
      if (error) throw error
      return data as Toiture
    },
  })
}
