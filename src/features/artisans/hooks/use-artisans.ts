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

/** Géocode l'adresse de l'artisan : du plus précis au moins précis
 *  (adresse complète → CP+ville → ville → CP) pour TOUJOURS le placer sur la
 *  carte dès qu'on a au moins une ville ou un code postal. */
async function enrichirAvecCoordonnees(input: ArtisanInput): Promise<ArtisanInput> {
  const candidats = [
    composerAdresse({ adresse: input.adresse, code_postal: input.code_postal, ville: input.ville }),
    composerAdresse({ code_postal: input.code_postal, ville: input.ville }),
    composerAdresse({ ville: input.ville }),
    composerAdresse({ code_postal: input.code_postal }),
  ].filter((a, i, arr): a is string => !!a && arr.indexOf(a) === i)

  if (candidats.length === 0) return { ...input, latitude: null, longitude: null }

  let coord = null
  for (const c of candidats) {
    coord = await geocoder(c)
    if (coord) break
  }
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

/** Marque (ou non) le contrat d'un artisan comme signé HORS application. */
export function useSetContratExterne() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, valeur }: { id: string; valeur: boolean }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ contrat_externe: valeur })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['artisans'] })
      qc.invalidateQueries({ queryKey: ['artisans', id] })
      qc.invalidateQueries({ queryKey: ['contrats', 'signes'] })
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
