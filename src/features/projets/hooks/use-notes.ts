import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Note } from '@/types/database'

const TABLE = 'projet_notes'

/** Notes d'un projet (les plus récentes d'abord). */
export function useNotes(projetId: string | undefined) {
  return useQuery({
    queryKey: ['notes', projetId],
    enabled: !!projetId,
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('projet_id', projetId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Ajoute une note rapide (auteur = email de l'utilisateur connecté). */
export function useAddNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projetId,
      contenu,
    }: {
      projetId: string
      contenu: string
    }): Promise<Note> => {
      const { data: u } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ projet_id: projetId, contenu, auteur: u.user?.email ?? null })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (n) => qc.invalidateQueries({ queryKey: ['notes', n.projet_id] }),
  })
}
