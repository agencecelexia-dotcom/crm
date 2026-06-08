import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { composerAdresse, geocoder } from '@/lib/geocoding'
import type { Artisan, ArtisanInput } from '@/types/database'

const TABLE = 'artisans'

// ------------------------------------------------------------
//  Hooks react-query pour les artisans (liste / détail / CRUD).
//  Le géocodage de l'adresse est fait automatiquement à l'enregistrement.
// ------------------------------------------------------------

/** Liste de tous les artisans (triés par nom). */
export function useArtisans() {
  return useQuery({
    queryKey: ['artisans'],
    queryFn: async (): Promise<Artisan[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('nom', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Détail d'un artisan par id. */
export function useArtisan(id: string | undefined) {
  return useQuery({
    queryKey: ['artisans', id],
    enabled: !!id,
    queryFn: async (): Promise<Artisan> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data
    },
  })
}

/** Géocode l'adresse de l'artisan si renseignée et renvoie le payload enrichi. */
async function enrichirAvecCoordonnees(input: ArtisanInput): Promise<ArtisanInput> {
  const adresse = composerAdresse(input)
  if (!adresse) return { ...input, latitude: null, longitude: null }
  const coord = await geocoder(adresse)
  return {
    ...input,
    latitude: coord?.lat ?? null,
    longitude: coord?.lon ?? null,
  }
}

/** Création d'un artisan. */
export function useCreateArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ArtisanInput): Promise<Artisan> => {
      const payload = await enrichirAvecCoordonnees(input)
      const { data, error } = await supabase
        .from(TABLE)
        .insert(payload)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['artisans'] }),
  })
}

/** Mise à jour d'un artisan. */
export function useUpdateArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: ArtisanInput
    }): Promise<Artisan> => {
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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['artisans'] })
      qc.invalidateQueries({ queryKey: ['artisans', data.id] })
    },
  })
}

/** Régénère le token (lien public) d'un artisan → révoque l'ancien lien. */
export function useRegenererTokenArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const nouveau = crypto.randomUUID().replace(/-/g, '')
      const { data, error } = await supabase
        .from(TABLE)
        .update({ token: nouveau })
        .eq('id', id)
        .select('token')
        .single()
      if (error) throw error
      return data.token as string
    },
    onSuccess: (_t, id) => {
      qc.invalidateQueries({ queryKey: ['artisans'] })
      qc.invalidateQueries({ queryKey: ['artisans', id] })
    },
  })
}

/** Suppression d'un artisan. */
export function useDeleteArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['artisans'] }),
  })
}
