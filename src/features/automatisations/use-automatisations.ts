import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

// Réglages des automatisations (table app_settings) + historique des relances.

export interface Reglages {
  auto_contrat: boolean
  auto_inaction: boolean
  auto_orphelin: boolean
  relance_premier_h: string
  relance_interval_h: string
  relance_escalade_h: string
  heure_debut: string
  heure_fin: string
}

const DEFAUTS: Reglages = {
  auto_contrat: true,
  auto_inaction: true,
  auto_orphelin: true,
  relance_premier_h: '24',
  relance_interval_h: '12',
  relance_escalade_h: '48',
  heure_debut: '8',
  heure_fin: '20',
}

export function useReglages() {
  return useQuery({
    queryKey: ['reglages'],
    queryFn: async (): Promise<Reglages> => {
      const { data, error } = await supabase.from('app_settings').select('cle, valeur')
      if (error) throw error
      const map = Object.fromEntries((data ?? []).map((r) => [r.cle, r.valeur]))
      return {
        auto_contrat: (map.auto_contrat ?? 'on') === 'on',
        auto_inaction: (map.auto_inaction ?? 'on') === 'on',
        auto_orphelin: (map.auto_orphelin ?? 'on') === 'on',
        relance_premier_h: map.relance_premier_h ?? DEFAUTS.relance_premier_h,
        relance_interval_h: map.relance_interval_h ?? DEFAUTS.relance_interval_h,
        relance_escalade_h: map.relance_escalade_h ?? DEFAUTS.relance_escalade_h,
        heure_debut: map.heure_debut ?? DEFAUTS.heure_debut,
        heure_fin: map.heure_fin ?? DEFAUTS.heure_fin,
      }
    },
  })
}

export function useSetReglage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ cle, valeur }: { cle: string; valeur: string }) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ cle, valeur, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reglages'] }),
  })
}

export interface RelanceLigne {
  id: string
  type: string
  cible: string
  sent_at: string
  projet: { client_nom: string } | null
}

/** Historique global des relances (pour la page Automatisations). */
export function useRelances(limit = 100) {
  return useQuery({
    queryKey: ['relances', limit],
    queryFn: async (): Promise<RelanceLigne[]> => {
      const { data, error } = await supabase
        .from('relances')
        .select('id, type, cible, sent_at, projet:projets(client_nom)')
        .order('sent_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as unknown as RelanceLigne[]
    },
  })
}

/** Relances d'un projet précis (timeline sur la fiche projet). */
export function useRelancesProjet(projetId: string | undefined) {
  return useQuery({
    queryKey: ['relances', 'projet', projetId],
    enabled: !!projetId,
    queryFn: async (): Promise<RelanceLigne[]> => {
      const { data, error } = await supabase
        .from('relances')
        .select('id, type, cible, sent_at, projet:projets(client_nom)')
        .eq('projet_id', projetId!)
        .order('sent_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as RelanceLigne[]
    },
  })
}
