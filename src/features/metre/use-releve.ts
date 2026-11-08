import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'
import type { Releve } from './releve'
import { bornerAttente, reprendreAttente, type AttenteMetre } from './attente-metre'

export * from './releve'

/**
 * Ce que l'écran de l'AGENCE envoie à la place d'un jeton d'artisan : les
 * fonctions vérifient alors la session du membre (`_membre.ts`), jamais ce mot.
 */
export const JETON_AGENCE = 'agence'

/** Ce que rend la fonction `releve-lidar`. */
export interface ReponseReleve extends AttenteMetre {
  ok?: boolean
  trouve?: boolean
  id?: string
  statut?: 'en_cours' | 'fait' | 'hors_couverture' | 'introuvable' | 'echec'
  motif?: string | null
  confiance?: 'haute' | 'moyenne' | 'basse' | null
  releve?: Releve | null
  fait_le?: string | null
}

/** L'IGN met 20 à 75 s à servir une maison : on redemande toutes les 4 s, trois minutes au plus. */
const INTERVALLE_MS = 4000
const DUREE_MAX_MS = 180_000

/**
 * Le relevé LiDAR d'une maison : lu dans le cache du serveur, ou lancé. Tant
 * qu'il est « en cours », l'écran garde ses chiffres d'avant et redemande.
 */
export function useReleve(token: string | undefined, cleabs: string | null, point: Point | null) {
  const qc = useQueryClient()
  const cle = ['releve', cleabs, token ?? null] as const
  const query = useQuery<ReponseReleve>({
    queryKey: cle,
    enabled: !!token && !!cleabs,
    // Un relevé fait ne bouge pas ; le serveur le garde.
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    refetchInterval: (q) =>
      q.state.status !== 'error' && q.state.data?.statut === 'en_cours' && !q.state.data.delaiDepasse ? INTERVALLE_MS : false,
    queryFn: async ({ signal }): Promise<ReponseReleve> => {
      const { data, error } = await supabase.functions.invoke('releve-lidar', {
        body: { token, cleabs, point },
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
      if (error) throw error
      if (!data || data.ok !== true || data.error) throw new Error('Le relevé n’a pas pu être chargé. Réessayez.')
      return bornerAttente(data as ReponseReleve, qc.getQueryData<ReponseReleve>(cle), Date.now(), DUREE_MAX_MS)
    },
  })
  const { refetch } = query
  const reprendre = useCallback(() => {
    qc.setQueryData<ReponseReleve>(['releve', cleabs, token ?? null], (etat) => reprendreAttente(etat, Date.now()))
    return refetch()
  }, [qc, cleabs, token, refetch])
  return { ...query, reprendre }
}
