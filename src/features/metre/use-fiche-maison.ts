import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

/**
 * Ce que l'État sait d'une maison, rassemblé en un appel.
 *
 * Six sources publiques et gratuites, interrogées côté serveur : les appeler
 * depuis le navigateur demanderait autant d'hôtes de plus dans la politique de
 * sécurité, sans pouvoir réessayer ni mettre en cache.
 *
 * `sources` dit ce qui a répondu : une absence n'est pas une réponse. « Pas de
 * DPE connu » ne veut pas dire « pas de DPE ».
 */
export interface FicheMaison {
  ok: boolean
  cache?: boolean
  recupere_le?: string
  rnb_id: string | null
  bdnb: {
    annee_construction?: number | null
    nb_log?: number | null
    nb_niveau?: number | null
    surface_emprise_sol?: number | null
    hauteur_mean?: number | null
    mat_mur_txt?: string | null
    mat_toit_txt?: string | null
    materiaux_structure_mur_exterieur?: string | null
    pourcentage_surface_baie_vitree_exterieur?: number | null
    type_isolation_mur_exterieur?: string | null
    alea_argile?: string | null
  } | null
  dpe: {
    total: number
    approche: boolean
    recent: {
      adresse_ban?: string | null
      date_etablissement_dpe?: string | null
      annee_construction?: number | null
      surface_habitable_logement?: number | null
      hauteur_sous_plafond?: number | null
      etiquette_dpe?: string | null
      qualite_isolation_murs?: string | null
      qualite_isolation_menuiseries?: string | null
      isolation_toiture?: number | null
      type_energie_principale_chauffage?: string | null
    }
  } | null
  urbanisme: {
    zonage: string | null
    zonage_libelle: string | null
    reglement: string | null
    abf: boolean
    abf_motifs: string[]
    servitudes: number
  } | null
  risques: { argile: string | null; seisme: string | null; rapport: string | null } | null
  cadastre: { idu?: string | null; contenance?: number | null; commune?: string | null } | null
  sources: Record<string, boolean>
}

export function useFicheMaison(
  token: string | undefined,
  cleabs: string | null,
  lat: number | null,
  lon: number | null,
) {
  return useQuery({
    queryKey: ['fiche-maison', cleabs, lat, lon],
    enabled: !!token && lat != null && lon != null,
    // Une maison de 1966 le restera : inutile de réinterroger six services.
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    queryFn: async (): Promise<FicheMaison | null> => {
      const { data, error } = await supabase.functions.invoke('fiche-maison', {
        body: { token, cleabs, lat, lon },
      })
      if (error) throw error
      return data as FicheMaison
    },
  })
}
