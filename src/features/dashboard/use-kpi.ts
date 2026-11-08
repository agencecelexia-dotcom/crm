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
 * Les bornes filtrent la date de création de l'AFFECTATION, donc la transmission
 * à l'artisan, et non la création du projet ou la signature. Les taux d'ouverture
 * et de devis portent sur toutes les transmissions. Le taux de signature porte
 * sur les devis avec une issue connue ; la conversion sur les dossiers clos ou
 * rendus (les dossiers encore en cours sont exclus de ces deux dénominateurs).
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

/** Indicateurs par période de transmission. Sans bornes : tout l'historique. */
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

/**
 * Chiffre d'affaires signé et commission, rangés au mois de la SIGNATURE
 * (`ca_signe_par_mois`, migration 0165). Le périmètre temporel diffère de
 * `kpi_agence` : un chantier transmis en juin et signé en août est rangé en
 * juin dans la cohorte de transmission, en août dans ce graphique.
 *
 * Le graphique lisait `projets.date_signature`, renseignée sur 3 dossiers
 * signés sur 15 : la courbe tombait à zéro en juillet, août et septembre, alors
 * qu'on avait signé 35 000 € en juillet et autant en août.
 */
export function useCaParMois(mois = 6) {
  return useQuery({
    queryKey: ['ca-signe-par-mois', mois],
    queryFn: async (): Promise<{ mois: string; ca: number; commission: number }[]> => {
      const { data, error } = await supabase.rpc('ca_signe_par_mois', { p_mois: mois })
      if (error) throw error
      return (data as { mois: string; ca: number; commission: number }[]) ?? []
    },
  })
}
