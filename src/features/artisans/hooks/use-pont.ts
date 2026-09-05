import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

// ------------------------------------------------------------
//  Pont entre l'espace artisan et le CRM propre de l'artisan.
//
//  Une ligne de configuration par artisan, plus deux journaux en lecture
//  seule : ce qui est parti et ce qui est arrivé. Les journaux sont ce qui
//  permet de répondre à « il dit qu'il a changé le statut, on ne l'a pas
//  reçu » — sans eux, l'intégration se débogue à l'aveugle.
// ------------------------------------------------------------

export interface PontArtisan {
  artisan_id: string
  actif: boolean
  url_webhook: string | null
  cle_publique: string
  secret: string
  derniere_reussite_at: string | null
  dernier_echec_at: string | null
  dernier_echec: string | null
  created_at: string
  updated_at: string
}

export interface EvenementSortant {
  id: number
  type: string
  etat: 'en_attente' | 'envoye' | 'echoue' | 'abandonne'
  tentatives: number
  code_http: number | null
  erreur: string | null
  envoye_at: string | null
  created_at: string
}

export interface EvenementEntrant {
  id: number
  evenement_id: string
  type: string | null
  charge: Record<string, unknown> | null
  resultat: Record<string, unknown> | null
  recu_at: string
}

/** Configuration du pont. `null` tant qu'aucun pont n'a été créé. */
export function usePont(artisanId: string | undefined) {
  return useQuery({
    queryKey: ['pont', artisanId],
    enabled: !!artisanId,
    queryFn: async (): Promise<PontArtisan | null> => {
      const { data, error } = await supabase
        .from('ponts_artisan')
        .select('*')
        .eq('artisan_id', artisanId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/**
 * Crée le pont s'il n'existe pas, ou met à jour ce qui est fourni.
 *
 * La clé publique et le secret sont posés par la base (valeurs par défaut) :
 * ils ne transitent jamais depuis le navigateur, où ils seraient devinables
 * par quiconque lit le bundle.
 */
export function useEnregistrerPont(artisanId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (champs: Partial<Pick<PontArtisan, 'actif' | 'url_webhook'>>) => {
      const { data, error } = await supabase
        .from('ponts_artisan')
        .upsert({ artisan_id: artisanId!, ...champs }, { onConflict: 'artisan_id' })
        .select('*')
        .single()
      if (error) throw error
      return data as PontArtisan
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pont', artisanId] }),
  })
}

/**
 * Régénère le secret de signature.
 *
 * Coupe immédiatement l'artisan : tant qu'il n'a pas repris la nouvelle
 * valeur, ses vérifications de signature échouent. C'est voulu — un secret
 * qu'on soupçonne d'avoir fuité doit cesser d'être valable tout de suite,
 * quitte à interrompre le service.
 */
export function useRegenererSecret(artisanId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // 32 octets aléatoires en hexadécimal, comme le défaut posé en base.
      const octets = crypto.getRandomValues(new Uint8Array(32))
      const secret = Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('')
      const { error } = await supabase
        .from('ponts_artisan')
        .update({ secret })
        .eq('artisan_id', artisanId!)
      if (error) throw error
      return secret
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pont', artisanId] }),
  })
}

/** Les 20 derniers envois, pour voir si le pont vit. */
export function useSortants(artisanId: string | undefined) {
  return useQuery({
    queryKey: ['pont-sortant', artisanId],
    enabled: !!artisanId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<EvenementSortant[]> => {
      const { data, error } = await supabase
        .from('pont_sortant')
        .select('id, type, etat, tentatives, code_http, erreur, envoye_at, created_at')
        .eq('artisan_id', artisanId!)
        .order('id', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
  })
}

/** Les 20 dernières réceptions. */
export function useEntrants(artisanId: string | undefined) {
  return useQuery({
    queryKey: ['pont-entrant', artisanId],
    enabled: !!artisanId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<EvenementEntrant[]> => {
      const { data, error } = await supabase
        .from('pont_entrant')
        .select('id, evenement_id, type, charge, resultat, recu_at')
        .eq('artisan_id', artisanId!)
        .order('id', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
  })
}
