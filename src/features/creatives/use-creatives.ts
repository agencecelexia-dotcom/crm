import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/** Un champ du formulaire, tel que le schéma du modèle le décrit. */
export interface ChampSchema {
  nom: string
  type: string
  titre?: string
  description?: string
  defaut?: unknown
  options?: string[]
  min?: number
  max?: number
  requis: boolean
}

export interface Creative {
  id: string
  modele: string
  categorie: string
  prompt: string | null
  parametres: Record<string, unknown>
  format: string | null
  statut: 'en_cours' | 'reussi' | 'echoue'
  fichiers: string[]
  cout_estime: number | null
  erreur: string | null
  created_at: string
}

/** Consommation du mois face au plafond. */
export function useQuota() {
  return useQuery({
    queryKey: ['creatives-quota'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('creatives_quota_restant')
      if (error) throw error
      return data as { utilise: number; plafond: number; reste: number }
    },
  })
}

export function useCreatives() {
  return useQuery({
    queryKey: ['creatives'],
    queryFn: async (): Promise<Creative[]> => {
      const { data, error } = await supabase
        .from('creatives')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(120)
      if (error) throw error
      return (data ?? []) as Creative[]
    },
  })
}

/**
 * Schéma d'un modèle, relayé par l'edge function.
 *
 * C'est ce qui permet au formulaire de s'adapter à n'importe lequel des 1 491
 * modèles au lieu d'en coder quelques-uns en dur. Mis en cache longuement :
 * un schéma ne change qu'à la sortie d'une nouvelle version du modèle.
 */
export function useSchemaModele(modele: string | null) {
  return useQuery({
    queryKey: ['creative-schema', modele],
    enabled: Boolean(modele),
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<ChampSchema[]> => {
      const { data, error } = await supabase.functions.invoke('creative-schema', {
        body: { modele },
      })
      if (error) throw error
      const r = data as { ok?: boolean; champs?: ChampSchema[]; error?: string }
      if (!r?.ok) throw new Error(r?.error ?? 'schema_indisponible')
      return r.champs ?? []
    },
  })
}

/** URL signée d'un fichier du bucket privé. */
export async function urlFichier(chemin: string) {
  const { data } = await supabase.storage.from('creatives').createSignedUrl(chemin, 3600)
  return data?.signedUrl ?? null
}

export function useGenerer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (corps: {
      modele: string
      categorie: string
      format: string | null
      coutEstime: number | null
      parametres: Record<string, unknown>
    }) => {
      const { data, error } = await supabase.functions.invoke('creative-generer', {
        body: corps,
      })
      if (error) throw error
      const r = data as { ok?: boolean; id?: string; error?: string; detail?: string }
      if (!r?.ok) {
        // Les refus métier doivent être compréhensibles : un message générique
        // laisserait croire à une panne alors que le refus est volontaire.
        const messages: Record<string, string> = {
          plafond_atteint: 'Plafond mensuel atteint. Relevez-le dans Automatisations.',
          compte_sans_credit: 'Le compte fal.ai n’a plus de crédit. Rechargez-le.',
          cle_refusee: 'La clé fal.ai est refusée. Vérifiez le secret FAL_KEY.',
          reserve_fondateur: 'Réservé aux fondateurs.',
          modele_invalide: 'Identifiant de modèle invalide.',
          cle_absente: 'Le secret FAL_KEY n’est pas configuré.',
        }
        throw new Error(messages[r?.error ?? ''] ?? r?.detail ?? 'Génération impossible.')
      }
      return r.id!
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creatives'] })
      void qc.invalidateQueries({ queryKey: ['creatives-quota'] })
    },
  })
}

/** Interroge fal et rapatrie le fichier quand la génération est terminée. */
export function useSuivre() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('creative-statut', {
        body: { id },
      })
      if (error) throw error
      return data as { ok?: boolean; statut?: string; fichiers?: string[] }
    },
    onSuccess: (r) => {
      if (r?.statut && r.statut !== 'en_cours') {
        void qc.invalidateQueries({ queryKey: ['creatives'] })
      }
    },
  })
}
