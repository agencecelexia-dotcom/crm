import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Prospect, StatutProspect } from '@/types/database'

/** Sociétés à démarcher autour d'un point (RPC : triées par distance). */
export function useProspectsAutour(
  lat: number | null | undefined,
  lon: number | null | undefined,
  metier: string | null,
  rayonKm = 150,
) {
  return useQuery({
    queryKey: ['prospects-autour', lat, lon, metier, rayonKm],
    enabled: lat != null && lon != null,
    queryFn: async (): Promise<Prospect[]> => {
      const { data, error } = await supabase.rpc('prospects_autour', {
        p_lat: lat,
        p_lon: lon,
        p_metier: metier || null,
        p_rayon_km: rayonKm,
      })
      if (error) throw error
      return (data as Prospect[]) ?? []
    },
  })
}

const invalider = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['prospects-autour'] })

/** Met à jour le statut/champs d'un prospect (qualification). */
export function useMajProspect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase
        .from('prospects')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalider(qc),
  })
}

/** « Pas de réponse » : +1 appel, revient dans 2 jours. */
export function usePasDeReponse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: Prospect) => {
      const { error } = await supabase
        .from('prospects')
        .update({
          statut: 'pas_repondu' satisfies StatutProspect,
          nb_appels: (p.nb_appels ?? 0) + 1,
          dernier_appel: new Date().toISOString(),
          rappel_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
        })
        .eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => invalider(qc),
  })
}

/** Recrute un prospect en artisan (apporteur) : copie la fiche + capture les
 *  sous-niches qu'il fait et son rayon d'intervention (pour la couverture). */
export function useConvertirEnArtisan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      prospectId,
      metiers,
      sousMetiers = [],
      rayonKm = null,
      departements = [],
    }: {
      prospectId: string
      metiers?: string[] // métiers retenus (peut élargir ceux du prospect)
      sousMetiers?: string[]
      rayonKm?: number | null // mode rayon (km autour de l'adresse)
      departements?: string[] // mode départements desservis
    }): Promise<string> => {
      const { data: p, error: e1 } = await supabase
        .from('prospects')
        .select('*')
        .eq('id', prospectId)
        .single()
      if (e1 || !p) throw e1 ?? new Error('Prospect introuvable')

      const { data: a, error: e2 } = await supabase
        .from('artisans')
        .insert({
          nom: p.company_name || 'Société',
          societe: p.company_name,
          telephone: p.tel,
          email: p.email,
          metiers: metiers ?? p.metiers ?? [],
          sous_metiers: sousMetiers,
          rayon_km: rayonKm,
          departements_couverts: departements,
          adresse: p.address && p.address !== '·' ? p.address : null,
          ville: p.city,
          code_postal: p.code_postal,
          latitude: p.lat,
          longitude: p.lon,
        })
        .select('id')
        .single()
      if (e2 || !a) throw e2 ?? new Error('Création artisan impossible')

      const { error: e3 } = await supabase
        .from('prospects')
        .update({ statut: 'converti', artisan_id: a.id, sous_metiers: sousMetiers })
        .eq('id', prospectId)
      if (e3) throw e3
      return a.id as string
    },
    onSuccess: () => {
      invalider(qc)
      qc.invalidateQueries({ queryKey: ['artisans'] })
      qc.invalidateQueries({ queryKey: ['couverture'] })
    },
  })
}
