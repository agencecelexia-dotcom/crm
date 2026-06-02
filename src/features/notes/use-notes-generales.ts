import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

// Bloc-notes général (table `notes`, non rattaché à un projet).
const TABLE = 'notes'

export interface NoteGenerale {
  id: string
  contenu: string
  auteur: string | null
  created_at: string
}

/** Toutes les notes générales (les plus récentes d'abord). */
export function useNotesGenerales() {
  return useQuery({
    queryKey: ['notes-generales'],
    queryFn: async (): Promise<NoteGenerale[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Ajoute une note (auteur = email de l'utilisateur connecté). */
export function useAddNoteGenerale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (contenu: string): Promise<NoteGenerale> => {
      const { data: u } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ contenu, auteur: u.user?.email ?? null })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes-generales'] }),
  })
}

/** Supprime une note. */
export function useDeleteNoteGenerale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes-generales'] }),
  })
}
