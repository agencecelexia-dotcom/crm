import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'
import type { LectureIA } from './modele3d'
import type { SceneIA, VerifScene } from './scene-ia'

/** Ce que rend la fonction `metre-ia`. */
export interface EtapeIA {
  cle: string
  libelle: string
  ms: number
}

export interface ReponseMetreIA {
  ok?: boolean
  error?: string
  trouve?: boolean
  statut?: 'en_cours' | 'fait' | 'echec'
  etape?: string | null
  etapes?: EtapeIA[]
  scene?: SceneIA | null
  niveaux?: LectureIA['niveaux'] | null
  verif?: VerifScene | null
  modele?: string | null
  motif?: string | null
  cout?: { duree_ms?: number; facades_lues?: number } | null
}

/** La lecture prend une à trois minutes : on redemande toutes les 3 s, six minutes au plus. */
const INTERVALLE_MS = 3000
const ESSAIS_MAX = 120

async function appeler(corps: Record<string, unknown>): Promise<ReponseMetreIA> {
  const { data, error } = await supabase.functions.invoke('metre-ia', { body: corps })
  if (error) throw error
  return data as ReponseMetreIA
}

/**
 * La lecture par l'IA d'une maison : ce qui est gardé (sans rien lancer), et le
 * lancement — un appui de l'artisan, jamais automatique : elle est payante.
 */
export function useMetreIA(token: string | undefined, cleabs: string | null, point: Point | null) {
  const qc = useQueryClient()
  const cle = ['metre-ia', cleabs]
  const etat = useQuery({
    queryKey: cle,
    enabled: !!token && !!cleabs,
    staleTime: 1000 * 30,
    retry: false,
    refetchInterval: (q) => (q.state.data?.statut === 'en_cours' && q.state.dataUpdateCount < ESSAIS_MAX ? INTERVALLE_MS : false),
    queryFn: () => appeler({ token, cleabs, action: 'etat' }),
  })
  const lancer = useMutation({
    mutationFn: () => appeler({ token, cleabs, action: 'lire', point }),
    onSuccess: (r) => qc.setQueryData(cle, r),
  })
  // Les façades lues par l'IA arrivent en base : la vue 3D relit les photos quand la lecture se termine.
  const statut = etat.data?.statut
  return { etat, lancer, statut, enCours: statut === 'en_cours' || lancer.isPending, refaire: () => {
      qc.invalidateQueries({ queryKey: ['photos-facade', cleabs] })
      // L'IA a pu remplacer le relevé gardé de la maison par ses pans corrigés.
      qc.invalidateQueries({ queryKey: ['releve', cleabs] })
    },
  }
}
