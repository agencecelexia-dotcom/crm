import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Tableau de bord d'un commercial.
 *
 * Trois états de gains, volontairement distincts — confondre « signé » et
 * « encaissé » donnerait au commercial une vision fausse de ce qui lui revient
 * vraiment : 80 % de la commission acquise de l'agence n'est pas encore
 * encaissée.
 */
export interface StatsCommercial {
  nom: string
  /** Part de la commission agence qui lui revient, ex. 0.10 pour 10 %. */
  taux: number

  leads_saisis: number
  leads_repris: number
  leads_actifs: number
  /** Leads sans aucun artisan actif : à placer, c'est son travail du jour. */
  a_attribuer: number

  signes: number
  perdus: number
  ca_genere: number

  /** Chantiers signés dont l'agence n'a pas encore encaissé. */
  gains_potentiels: number
  /** L'agence a encaissé, le versement au commercial reste à faire. */
  gains_a_percevoir: number
  gains_verses: number

  /** Chantiers rendus par un artisan et que plus personne ne suit. */
  a_reprendre: number
}

export function useStatsCommercial() {
  return useQuery({
    queryKey: ['stats-commercial'],
    queryFn: async (): Promise<StatsCommercial> => {
      const { data, error } = await supabase.rpc('mes_stats_commercial')
      if (error) throw error
      return data as StatsCommercial
    },
  })
}

export interface Retrocession {
  id: string
  projet_id: string
  commission_agence: number
  taux: number
  montant: number
  statut: 'a_verser' | 'verse' | 'annule'
  verse_at: string | null
  created_at: string
}

/** Le détail ligne à ligne : le commercial doit pouvoir refaire le calcul. */
export function useMesRetrocessions() {
  return useQuery({
    queryKey: ['mes-retrocessions'],
    queryFn: async (): Promise<Retrocession[]> => {
      const { data, error } = await supabase
        .from('retrocessions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Retrocession[]
    },
  })
}
