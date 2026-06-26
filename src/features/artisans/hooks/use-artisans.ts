import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { composerAdresse, geocoder } from '@/lib/geocoding'
import { soliditeEntreprise } from '@/lib/entreprise'
import type { Artisan, ArtisanInput, ScoringArtisan } from '@/types/database'

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
        .is('ecarte_at', null)
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

/** Liste des artisans ÉCARTÉS (« pas fiables »), conservés à part. */
export function useArtisansEcartes() {
  return useQuery({
    queryKey: ['artisans', 'ecartes'],
    queryFn: async (): Promise<Artisan[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .not('ecarte_at', 'is', null)
        .order('ecarte_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Écarte un artisan (« pas fiable ») : il quitte la liste active, conservé à part. */
export function useEcarterArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, motif }: { id: string; motif?: string }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ ecarte_at: new Date().toISOString(), ecarte_motif: motif || null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['artisans'] })
      qc.invalidateQueries({ queryKey: ['artisans', id] })
    },
  })
}

/** Réintègre un artisan écarté dans la liste active. */
export function useReactiverArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ ecarte_at: null, ecarte_motif: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, id) => {
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

/** Scoring interne d'un artisan (métriques auto + notes manuelles). */
export function useScoringArtisan(id: string | undefined) {
  return useQuery({
    queryKey: ['scoring-artisan', id],
    enabled: !!id,
    queryFn: async (): Promise<ScoringArtisan> => {
      const { data, error } = await supabase.rpc('scoring_artisan', { p_artisan_id: id! })
      if (error) throw error
      return data as ScoringArtisan
    },
  })
}

/** Solidité / solvabilité (indicatif) calculée depuis l'API entreprise (via SIREN). */
export function useSolidite(siren: string | null | undefined) {
  return useQuery({
    queryKey: ['solidite', siren],
    enabled: !!siren && siren.replace(/\D/g, '').length >= 9,
    staleTime: 1000 * 60 * 60 * 24, // données entreprise quasi stables → cache 24 h
    queryFn: () => soliditeEntreprise(siren!),
  })
}

/** Enregistre une note qualitative manuelle (1-5, ou null pour effacer). */
export function useNoterArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      id: string
      champ: 'note_elocution' | 'note_communication_agence'
      valeur: number | null
    }): Promise<void> => {
      const { error } = await supabase.from(TABLE).update({ [v.champ]: v.valeur }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['artisans', v.id] })
      qc.invalidateQueries({ queryKey: ['scoring-artisan', v.id] })
    },
  })
}
