import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'
import type { LectureIA } from './modele3d'
import type { SceneIA, VerifScene } from './scene-ia'
import { bornerAttente, reprendreAttente, type AttenteMetre } from './attente-metre'

/** Ce que rend la fonction `metre-ia`. */
export interface EtapeIA {
  cle: string
  libelle: string
  /** 1 photos, 2 analyse, 3 mesures, 4 la 3D. */
  phase?: number
  ms: number
  /** Vrai tant que l'étape tourne. */
  en_cours?: boolean
}

export interface ReponseMetreIA extends AttenteMetre {
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
  cout?: { duree_ms?: number; facades_lues?: number; photos_retenues?: number; photos_ecartees?: number } | null
}

/** La lecture prend une à trois minutes : on redemande toutes les 3 s, six minutes au plus. */
const INTERVALLE_MS = 3000
const DUREE_MAX_MS = 360_000

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
    refetchInterval: (q) => (q.state.status !== 'error' && q.state.data?.statut === 'en_cours' && !q.state.data.delaiDepasse ? INTERVALLE_MS : false),
    queryFn: async () => bornerAttente(await appeler({ token, cleabs, action: 'etat' }), qc.getQueryData<ReponseMetreIA>(cle), Date.now(), DUREE_MAX_MS),
  })
  const lancer = useMutation({
    mutationFn: () => appeler({ token, cleabs, action: 'lire', point }),
    onSuccess: (r) => qc.setQueryData(cle, bornerAttente(r, undefined, Date.now(), DUREE_MAX_MS)),
  })
  // Les façades lues par l'IA arrivent en base : la vue 3D relit les photos quand la lecture se termine.
  const statut = etat.data?.statut
  const refaire = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['photos-facade', token ?? null, cleabs] })
    // Cette référence doit rester stable : les vues l'appellent à la fin de
    // l'analyse, pas à chaque changement de fond ou sélection d'une face.
    void qc.invalidateQueries({ queryKey: ['releve', cleabs] })
  }, [qc, cleabs, token])
  const { refetch } = etat
  const reprendre = useCallback(() => {
    qc.setQueryData<ReponseMetreIA>(['metre-ia', cleabs], (r) => reprendreAttente(r, Date.now()))
    // Une vérification de l'état, jamais un nouvel appel payant « lire ».
    return refetch()
  }, [qc, cleabs, refetch])
  return { etat, lancer, statut, enCours: (statut === 'en_cours' && !etat.data?.delaiDepasse && !etat.isError) || lancer.isPending, refaire, reprendre }
}
