import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

/**
 * L'identité de l'entreprise, saisie une fois et portée par tous ses devis.
 *
 * `manquants` liste ce qui reste à renseigner pour qu'un devis soit
 * irréprochable — une liste plutôt qu'un pourcentage : l'artisan doit savoir
 * quoi faire, pas où il en est.
 */
export interface IdentiteArtisan {
  societe: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
  telephone: string | null
  email: string | null
  siren: string | null
  forme_juridique: string | null
  capital_social: string | null
  ville_immatriculation: string | null
  representant: string | null
  logo_url: string | null
  tva_intracom: string | null
  code_ape: string | null
  iban: string | null
  bic: string | null
  mediateur_nom: string | null
  mediateur_url: string | null
  cgv: string
  cgv_personnalisees: boolean
  conditions_paiement: string | null
  garantie_zone: string | null
  acompte_defaut: number | null
  tva_mode_defaut: 'franchise' | 'normal' | null
  assurance: {
    decennale_assureur: string | null
    decennale_police: string | null
    decennale_echeance: string | null
    rc_pro_assureur: string | null
    rc_pro_police: string | null
  }
  manquants: string[]
}

export function useIdentite(token: string | undefined) {
  return useQuery({
    queryKey: ['identite', token],
    enabled: !!token,
    queryFn: async (): Promise<IdentiteArtisan | null> => {
      const { data, error } = await supabase.rpc('identite_by_token', { p_token: token })
      if (error) throw error
      return (data as IdentiteArtisan | null) ?? null
    },
  })
}

export function useEnregistrerIdentite(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc('enregistrer_identite_by_token', {
        p_token: token,
        p_payload: payload,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) throw new Error(r.error)
      return r
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['identite', token] })
      void qc.invalidateQueries({ queryKey: ['espace-artisan', token] })
    },
  })
}
