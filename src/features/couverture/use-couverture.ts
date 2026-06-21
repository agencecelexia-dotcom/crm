import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { SOUS_METIERS } from '@/lib/constants'
import type { CouvertureCell, CouvertureZone, StatutCouverture } from '@/types/database'

export const CIBLE_COUVERTURE = 3

export const STATUT_COULEUR: Record<StatutCouverture, string> = {
  vide: '#EF4444', // rouge — aucun artisan
  partiel: '#F59E0B', // ambre — 1 à cible-1
  couvert: '#22C55E', // vert — cible atteinte
}

/** Tableau : zone × sous-niche pour un métier (cellules X/cible). */
export function useCouvertureGrille(metier: string, departement?: string | null) {
  return useQuery({
    queryKey: ['couverture', 'grille', metier, departement ?? null],
    enabled: !!metier,
    queryFn: async (): Promise<CouvertureCell[]> => {
      const { data, error } = await supabase.rpc('couverture_grille', {
        p_metier: metier,
        p_sous_metiers: SOUS_METIERS[metier] ?? [],
        p_cible: CIBLE_COUVERTURE,
        p_departement: departement || null,
      })
      if (error) throw error
      return (data as CouvertureCell[]) ?? []
    },
  })
}

/** Carte : une ligne par zone pour un métier (+ sous-niche optionnelle). */
export function useCouvertureCarte(metier: string, sousMetier: string | null) {
  return useQuery({
    queryKey: ['couverture', 'carte', metier, sousMetier ?? null],
    enabled: !!metier,
    queryFn: async (): Promise<CouvertureZone[]> => {
      const { data, error } = await supabase.rpc('couverture_carte', {
        p_metier: metier,
        p_sous_metier: sousMetier || null,
        p_cible: CIBLE_COUVERTURE,
      })
      if (error) throw error
      return (data as CouvertureZone[]) ?? []
    },
  })
}
