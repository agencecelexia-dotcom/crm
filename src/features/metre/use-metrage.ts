import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Unite } from './catalogue-metrage'
import { messageMetre } from './use-metres'

/**
 * Le dossier de métrés d'un chantier (0171) : ce que dit le client, ce que
 * mesure l'outil, ce qu'on retient. Le statut se déduit en base ; l'écran ne
 * fait que le montrer.
 */
export type StatutMetrage = 'mesure' | 'declare' | 'coherent' | 'ecart' | 'sources_desaccord' | 'confirme'

export interface LigneMetrage {
  cle: string
  unite: Unite
  valeur_declaree: number | null
  declaree_par: 'client' | 'agence' | 'artisan' | null
  citation: string | null
  valeur_mesuree: number | null
  mesure_source: string | null
  mesure_detail?: unknown
  statut: StatutMetrage
  valeur_retenue: number | null
  retenue_par: 'outil' | 'agence' | 'artisan' | null
  note: string | null
}

const COLONNES =
  'cle, unite, valeur_declaree, declaree_par, citation, valeur_mesuree, mesure_source, mesure_detail, statut, valeur_retenue, retenue_par, note'

const cleProjet = (projetId: string) => ['metrage', projetId] as const

/** Le dossier, vu de l'agence : la RLS ordinaire, comme les métrés. */
export function useMetrageProjet(projetId: string) {
  return useQuery({
    queryKey: cleProjet(projetId),
    queryFn: async (): Promise<LigneMetrage[]> => {
      const { data, error } = await supabase.from('metrage_chantier').select(COLONNES).eq('projet_id', projetId)
      if (error) throw error
      return (data as unknown as LigneMetrage[]) ?? []
    },
  })
}

/** « Le client dit dix mètres. » La valeur mesurée, si elle existe, n'est pas touchée. */
export function useDeclarerMetrage(projetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { cle: string; unite: Unite; valeur: number | null; citation?: string | null }) => {
      const { error } = await supabase.from('metrage_chantier').upsert(
        {
          projet_id: projetId,
          cle: p.cle,
          unite: p.unite,
          valeur_declaree: p.valeur,
          declaree_par: p.valeur == null ? null : 'client',
          declaree_source: p.valeur == null ? null : 'saisie',
          citation: p.citation?.trim() || null,
          declaree_le: p.valeur == null ? null : new Date().toISOString(),
        },
        { onConflict: 'projet_id,cle' },
      )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cleProjet(projetId) }),
  })
}

/** L'agence tranche : cette valeur est celle que l'artisan lira. */
export function useTrancherMetrage(projetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { cle: string; unite: Unite; valeur: number }) => {
      const { error } = await supabase.from('metrage_chantier').upsert(
        {
          projet_id: projetId,
          cle: p.cle,
          unite: p.unite,
          statut: 'confirme',
          valeur_retenue: p.valeur,
          retenue_par: 'agence',
          retenue_le: new Date().toISOString(),
        },
        { onConflict: 'projet_id,cle' },
      )
      if (error) throw error
    },
    // La file de vérification et « À traiter » comptent les écarts : un
    // arbitrage doit les faire baisser tout de suite.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: cleProjet(projetId) }),
        qc.invalidateQueries({ queryKey: ['metrages-a-verifier'] }),
        qc.invalidateQueries({ queryKey: ['a-traiter'] }),
      ]),
  })
}

/** Le dossier, vu de l'artisan : par son jeton. */
export function useMetrageArtisan(token: string | undefined, affectationToken: string) {
  return useQuery({
    queryKey: ['metrage-artisan', token ?? null, affectationToken],
    enabled: !!token,
    queryFn: async (): Promise<LigneMetrage[]> => {
      const { data, error } = await supabase.rpc('metrage_by_token', {
        p_token: token,
        p_affectation_token: affectationToken,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string; metrage?: LigneMetrage[] }
      if (!r.ok) throw new Error(messageMetre(r.error))
      return r.metrage ?? []
    },
  })
}

/** « Mesuré sur place » : la valeur de l'artisan devient celle qu'on retient. */
export function useCorrigerMetrageArtisan(token: string | undefined, affectationToken: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { cle: string; unite: Unite; valeur: number; note?: string | null }) => {
      const { data, error } = await supabase.rpc('corriger_metrage_by_token', {
        p_token: token,
        p_affectation_token: affectationToken,
        p_cle: p.cle,
        p_unite: p.unite,
        p_valeur: p.valeur,
        p_note: p.note ?? null,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) throw new Error(messageMetre(r.error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metrage-artisan', token ?? null, affectationToken] }),
  })
}

/** Pour chaque chantier de l'artisan : ses métrés sont-ils prêts, ou à vérifier ? */
export function useEtatsMetrage(token: string | undefined) {
  return useQuery({
    queryKey: ['etats-metrage', token ?? null],
    enabled: !!token,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<Map<string, { retenues: number; a_verifier: number }>> => {
      const { data, error } = await supabase.rpc('etats_metrage_by_token', { p_token: token })
      if (error) throw error
      const r = data as {
        ok: boolean
        chantiers?: { affectation_token: string; retenues: number; a_verifier: number }[]
      }
      return new Map((r.ok ? (r.chantiers ?? []) : []).map((c) => [c.affectation_token, c]))
    },
  })
}
