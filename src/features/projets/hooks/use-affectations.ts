import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { StatutProjet } from '@/types/database'

// Affectations = couples artisan↔projet (un projet peut être confié à plusieurs
// artisans en parallèle, chacun avec son état propre).
export interface Affectation {
  id: string
  projet_id: string
  artisan_id: string
  token: string
  statut: StatutProjet
  devis_url: string | null
  devis_signe_url: string | null
  montant_devis: number | null
  montant_devis_signe: number | null
  artisan: { id: string; nom: string; prenom: string | null; societe: string | null } | null
}

const SEL = '*, artisan:artisans(id, nom, prenom, societe)'

/** Affectations d'un projet (les artisans qu'on lui a confiés). */
export function useAffectations(projetId: string | undefined) {
  return useQuery({
    queryKey: ['affectations', 'projet', projetId],
    enabled: !!projetId,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Affectation[]> => {
      const { data, error } = await supabase
        .from('affectations')
        .select(SEL)
        .eq('projet_id', projetId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Affectation[]
    },
  })
}

/** Nombre d'artisans assignés par projet (pour les cartes liste / Kanban). */
export function useAffectationsCounts() {
  return useQuery({
    queryKey: ['affectations', 'counts'],
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('affectations').select('projet_id')
      if (error) throw error
      const m: Record<string, number> = {}
      for (const r of data ?? []) m[r.projet_id] = (m[r.projet_id] ?? 0) + 1
      return m
    },
  })
}

/** Assigne un ou plusieurs artisans à un projet (crée les affectations manquantes). */
export function useAffecterArtisans() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projetId, artisanIds }: { projetId: string; artisanIds: string[] }) => {
      if (artisanIds.length === 0) return
      const rows = artisanIds.map((id) => ({
        projet_id: projetId,
        artisan_id: id,
        statut: 'artisan_assigne' as const,
      }))
      const { error } = await supabase
        .from('affectations')
        .upsert(rows, { onConflict: 'projet_id,artisan_id', ignoreDuplicates: true })
      if (error) throw error
      // Artisan principal (compat) + passage du projet en "artisan assigné"
      const { data: p } = await supabase
        .from('projets')
        .select('artisan_id, statut')
        .eq('id', projetId)
        .single()
      const patch: Record<string, unknown> = {}
      if (p && !p.artisan_id) patch.artisan_id = artisanIds[0]
      if (p && p.statut === 'nouveau') patch.statut = 'artisan_assigne'
      if (Object.keys(patch).length) await supabase.from('projets').update(patch).eq('id', projetId)
    },
    onSuccess: (_d, { projetId }) => {
      qc.invalidateQueries({ queryKey: ['affectations', 'projet', projetId] })
      qc.invalidateQueries({ queryKey: ['projets'] })
    },
  })
}

/** Retire une affectation (le projet quitte l'espace de cet artisan). */
export function useRetirerAffectation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projetId }: { id: string; projetId: string }) => {
      const { error } = await supabase.from('affectations').delete().eq('id', id)
      if (error) throw error
      // Recalcule l'artisan principal du projet (compat)
      const { data: reste } = await supabase
        .from('affectations')
        .select('artisan_id')
        .eq('projet_id', projetId)
        .limit(1)
      const principal = reste && reste.length ? reste[0].artisan_id : null
      const patch: Record<string, unknown> = { artisan_id: principal }
      if (!principal) patch.statut = 'nouveau'
      await supabase.from('projets').update(patch).eq('id', projetId)
    },
    onSuccess: (_d, { projetId }) => {
      qc.invalidateQueries({ queryKey: ['affectations', 'projet', projetId] })
      qc.invalidateQueries({ queryKey: ['projets'] })
    },
  })
}
