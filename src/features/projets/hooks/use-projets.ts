import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { composerAdresse, geocoder } from '@/lib/geocoding'
import type { Projet, ProjetAvecArtisan, ProjetInput } from '@/types/database'

const TABLE = 'projets'
// Jointure légère vers l'artisan assigné (pour l'affichage en liste/fiche).
const SELECT_AVEC_ARTISAN =
  '*, artisan:artisans(id, nom, prenom, societe)'

// ------------------------------------------------------------
//  Hooks react-query pour les projets.
// ------------------------------------------------------------

/** Liste de tous les projets (récents d'abord), avec leur artisan. */
export function useProjets() {
  return useQuery({
    queryKey: ['projets'],
    queryFn: async (): Promise<ProjetAvecArtisan[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select(SELECT_AVEC_ARTISAN)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ProjetAvecArtisan[]
    },
  })
}

/** Détail d'un projet par id (avec artisan). */
export function useProjet(id: string | undefined) {
  return useQuery({
    queryKey: ['projets', id],
    enabled: !!id,
    queryFn: async (): Promise<ProjetAvecArtisan> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select(SELECT_AVEC_ARTISAN)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as ProjetAvecArtisan
    },
  })
}

/** Projets rattachés à un artisan donné (pour l'historique de sa fiche). */
export function useProjetsByArtisan(artisanId: string | undefined) {
  return useQuery({
    queryKey: ['projets', 'by-artisan', artisanId],
    enabled: !!artisanId,
    queryFn: async (): Promise<Projet[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('artisan_id', artisanId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Géocode l'adresse client si renseignée. */
async function enrichirAvecCoordonnees(
  input: ProjetInput,
): Promise<ProjetInput> {
  const adresse = composerAdresse({
    adresse: input.client_adresse,
    code_postal: input.client_code_postal,
    ville: input.client_ville,
  })
  if (!adresse) return { ...input, latitude: null, longitude: null }
  const coord = await geocoder(adresse)
  return {
    ...input,
    latitude: coord?.lat ?? null,
    longitude: coord?.lon ?? null,
  }
}

function invalider(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['projets'] })
  if (id) qc.invalidateQueries({ queryKey: ['projets', id] })
}

/** Création d'un projet (renseigne created_by + géocode l'adresse client). */
export function useCreateProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ProjetInput): Promise<Projet> => {
      const payload = await enrichirAvecCoordonnees(input)
      const { data: userData } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ ...payload, created_by: userData.user?.id ?? null })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalider(qc),
  })
}

/** Mise à jour complète d'un projet (re-géocode si l'adresse change). */
export function useUpdateProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: ProjetInput
    }): Promise<Projet> => {
      const payload = await enrichirAvecCoordonnees(input)
      const { data, error } = await supabase
        .from(TABLE)
        .update(payload)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => invalider(qc, data.id),
  })
}

/**
 * Mise à jour partielle d'un projet (statut, montants, fichiers, encaissement…).
 * Pratique pour les actions rapides de la fiche sans repasser tout le formulaire.
 */
export function usePatchProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<ProjetInput>
    }): Promise<Projet> => {
      const { data, error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => invalider(qc, data.id),
  })
}

/** Suppression d'un projet. */
export function useDeleteProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalider(qc),
  })
}
