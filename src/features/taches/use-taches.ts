import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export interface Tache {
  id: string
  titre: string
  details: string | null
  priorite: number // 1 haute, 2 moyenne, 3 basse
  valeur: number | null // valeur € (pour trier les plus gros d'abord)
  type: 'manuel' | 'auto'
  categorie: string | null
  projet_id: string | null
  artisan_id: string | null
  tel: string | null
  statut: 'a_faire' | 'fait'
  done_at: string | null
  nb_appels: number
  dernier_appel: string | null
  rappel_at: string | null
  notifie_at: string | null
  rappel_pour: string | null
  rappel_email: string | null
  created_at: string
}

const qc_key = ['taches']

/** Liste des tâches : régénère les tâches auto puis récupère tout. */
export function useTaches() {
  return useQuery({
    queryKey: qc_key,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Tache[]> => {
      await supabase.rpc('rafraichir_taches')
      const { data, error } = await supabase
        .from('taches')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Tache[]
    },
  })
}

export function useAjouterTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: { titre: string; details?: string; priorite: number; tel?: string }) => {
      const { error } = await supabase.from('taches').insert({
        titre: t.titre,
        details: t.details || null,
        priorite: t.priorite,
        tel: t.tel || null,
        type: 'manuel',
        categorie: t.tel ? 'appel' : 'autre',
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qc_key }),
  })
}

/** Crée un RAPPEL : une tâche datée (categorie='rappel') qui s'envoie aussi par
 *  email à l'échéance (cf. traiter_rappels côté base). Apparaît dans la to-do. */
export function useAjouterRappel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: {
      titre: string
      details?: string
      priorite?: number
      rappel_at: string // ISO (datetime de l'échéance)
      pour?: string // nom pour l'objet du mail (« Thomas »)
      projet_id?: string
    }) => {
      const { error } = await supabase.from('taches').insert({
        titre: t.titre,
        details: t.details || null,
        priorite: t.priorite ?? 2,
        type: 'manuel',
        categorie: 'rappel',
        rappel_at: t.rappel_at,
        rappel_pour: t.pour || null,
        projet_id: t.projet_id || null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qc_key }),
  })
}

/** Coche / décoche une tâche (faite → supprimée auto 24 h après). */
export function useToggleTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, fait }: { id: string; fait: boolean }) => {
      const { error } = await supabase
        .from('taches')
        .update({ statut: fait ? 'fait' : 'a_faire', done_at: fait ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qc_key }),
  })
}

/** Appel sans réponse : mémorise l'appel et reporte la tâche de 4 h. */
export function useAppelSansReponse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: Tache) => {
      const { error } = await supabase
        .from('taches')
        .update({
          nb_appels: t.nb_appels + 1,
          dernier_appel: new Date().toISOString(),
          rappel_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        })
        .eq('id', t.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qc_key }),
  })
}

/** Synchro deux sens : encaisser la commission depuis la to-do → met à jour le
 *  CRM (projets.commission_encaissee), ce qui fait disparaître la tâche auto. */
export function useEncaisserCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (projetId: string) => {
      const { error } = await supabase
        .from('projets')
        .update({ commission_encaissee: true })
        .eq('id', projetId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qc_key })
      qc.invalidateQueries({ queryKey: ['projets'] })
    },
  })
}

export function useSupprimerTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('taches').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qc_key }),
  })
}
