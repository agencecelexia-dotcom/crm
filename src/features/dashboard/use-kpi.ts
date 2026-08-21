import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Indicateurs de l'agence, source unique (migration 0103).
 *
 * Tout part de `affectations` : c'est le seul niveau qui sait QUEL artisan a
 * signé. L'ancienne `stats_agence()` lisait `projets.statut` pour certains
 * compteurs et `affectations` pour d'autres — d'où deux chiffres différents sur
 * le même écran, et 92 750 € d'écart sur le chiffre d'affaires.
 *
 * Chaque taux porte son dénominateur dans son nom : `sur_transmis` compte sur
 * tout ce qui est parti chez un artisan, `sur_devis` seulement sur les dossiers
 * arrivés au chiffrage. Les deux sont utiles ; les confondre était l'erreur.
 */
export interface KpiAgence {
  // Volume
  leads_transmis: number
  leads_actifs: number
  leads_rendus: number
  artisans_sollicites: number

  // Parcours
  jamais_ouverts: number
  contactes: number
  rdv_pris: number
  devis_envoyes: number
  signes: number
  perdus: number

  // Taux — le suffixe dit sur quoi ils portent
  taux_ouverture_sur_transmis: number | null
  taux_devis_sur_transmis: number | null
  taux_signature_sur_devis: number | null
  taux_conversion_global: number | null

  // Délais médians, en jours
  delai_ouverture_j: number | null
  delai_signature_j: number | null
  delai_devis_signe_j: number | null
  /** Nombre d'observations : un délai sur 2 dossiers ne veut rien dire. */
  delai_signature_n: number

  // Argent
  ca_signe: number
  panier_moyen: number | null
  panier_median: number | null
  devis_moyen_envoye: number | null
  devis_median_envoye: number | null
  pipe_chiffre: number
  montant_perdu: number

  // Commission
  commission_acquise: number
  commission_encaissee: number
  commission_a_encaisser: number
  taux_commission_moyen: number | null

  periode_debut: string | null
  periode_fin: string | null
}

export interface KpiArtisan {
  artisan_id: string
  artisan_nom: string
  leads_transmis: number
  rendus: number
  jamais_ouverts: number
  devis_envoyes: number
  signes: number
  perdus: number
  taux_conversion_global: number | null
  ca_signe: number
  panier_moyen: number | null
  delai_signature_j: number | null
}

/** Indicateurs agrégés. Sans bornes de dates, porte sur tout l'historique. */
export function useKpiAgence(debut?: string, fin?: string) {
  return useQuery({
    queryKey: ['kpi-agence', debut ?? null, fin ?? null],
    queryFn: async (): Promise<KpiAgence> => {
      const { data, error } = await supabase.rpc('kpi_agence', {
        p_debut: debut ?? null,
        p_fin: fin ?? null,
      })
      if (error) throw error
      return data as KpiAgence
    },
  })
}

/** Mêmes indicateurs ventilés par artisan, comparables ligne à ligne. */
export function useKpiParArtisan(debut?: string, fin?: string) {
  return useQuery({
    queryKey: ['kpi-artisan', debut ?? null, fin ?? null],
    queryFn: async (): Promise<KpiArtisan[]> => {
      const { data, error } = await supabase.rpc('kpi_par_artisan', {
        p_debut: debut ?? null,
        p_fin: fin ?? null,
      })
      if (error) throw error
      return (data ?? []) as KpiArtisan[]
    },
  })
}
