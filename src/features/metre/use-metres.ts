import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'

/** Une mesure enregistrée sur un chantier (0145). */
export interface Metre {
  id: string
  nom: string
  type: 'surface' | 'longueur' | 'facade'
  geometrie: Point[]
  surface_m2: number | null
  perimetre_m: number | null
  longueur_m: number | null
  hauteur_m: number | null
  pente_pct: number | null
  surface_reelle_m2: number | null
  ouvertures_m2: number | null
  azimut: number | null
  pente_source: 'altitudes' | 'saisie' | null
  hauteur_source: 'bati' | 'saisie' | null
  source: 'bati' | 'dessin'
  created_at: string
}

/**
 * Ce qu'il faut pour ouvrir la carte cadrée sur le chantier.
 *
 * Passe par une fonction dédiée plutôt que par `get_espace_artisan`, qui ne
 * renvoie ni latitude ni longitude et qu'on évite de rouvrir — elle a déjà été
 * réécrite quinze fois.
 */
export interface ContexteMetre {
  ok: boolean
  error?: string
  projet_id: string | null
  affectation_id: string | null
  client_ville: string | null
  client_adresse: string | null
  client_code_postal: string | null
  latitude: number | null
  longitude: number | null
  metier: string | null
  metres: Metre[]
}

export function useContexteMetre(token: string | undefined, affectationToken?: string | null) {
  return useQuery({
    queryKey: ['metre-contexte', token, affectationToken ?? null],
    enabled: !!token,
    queryFn: async (): Promise<ContexteMetre | null> => {
      const { data, error } = await supabase.rpc('metre_contexte_by_token', {
        p_token: token,
        p_affectation_token: affectationToken ?? null,
      })
      if (error) throw error
      return (data as ContexteMetre) ?? null
    },
  })
}

export function useEnregistrerMetre(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      affectation_token: string
      nom: string
      type: 'surface' | 'longueur' | 'facade'
      geometrie: Point[]
      hauteur_m?: number | null
      pente_pct?: number | null
      source?: 'bati' | 'dessin'
      ouvertures_m2?: number | null
      azimut?: number | null
      pente_source?: 'altitudes' | 'saisie' | null
      hauteur_source?: 'bati' | 'saisie' | null
    }) => {
      const { data, error } = await supabase.rpc('enregistrer_metre_by_token', {
        p_token: token,
        p_affectation_token: p.affectation_token,
        p_nom: p.nom,
        p_type: p.type,
        p_geometrie: p.geometrie,
        p_hauteur_m: p.hauteur_m ?? null,
        p_pente_pct: p.pente_pct ?? null,
        p_source: p.source ?? 'dessin',
        p_ouvertures_m2: p.ouvertures_m2 ?? null,
        p_azimut: p.azimut ?? null,
        p_pente_source: p.pente_source ?? null,
        p_hauteur_source: p.hauteur_source ?? null,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) throw new Error(r.error)
      return r as { ok: true; id: string; surface_m2: number | null }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metre-contexte'] }),
  })
}

export function useSupprimerMetre(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('supprimer_metre_by_token', {
        p_token: token,
        p_id: id,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metre-contexte'] }),
  })
}

/**
 * Le recadrage répare la donnée.
 *
 * 17 % des chantiers n'ont aucune coordonnée, et ceux qui arrivent par le pont
 * n'en ont jamais. Quand l'artisan replace la carte sur la vraie maison, la
 * position est écrite sur le projet : l'agence en profite aussi.
 */
export function useCorrigerPosition(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { affectation_token: string; lat: number; lon: number }) => {
      const { data, error } = await supabase.rpc('corriger_position_by_token', {
        p_token: token,
        p_affectation_token: p.affectation_token,
        p_lat: p.lat,
        p_lon: p.lon,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) throw new Error(r.error)
      return r
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metre-contexte'] }),
  })
}

/** Recherche d'adresse (Base Adresse Nationale) — gratuite, sans clé. */
export interface Adresse {
  label: string
  lat: number
  lon: number
  precise: boolean
}

export async function chercherAdresse(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  if (q.trim().length < 3) return []
  const url = new URL('https://api-adresse.data.gouv.fr/search/')
  url.searchParams.set('q', q.trim())
  url.searchParams.set('limit', '5')
  const rep = await fetch(url, { signal })
  if (!rep.ok) return []
  const j = (await rep.json()) as {
    features?: { properties?: { label?: string; type?: string }; geometry?: { coordinates?: number[] } }[]
  }
  return (j.features ?? [])
    .map((f) => ({
      label: f.properties?.label ?? '',
      lon: f.geometry?.coordinates?.[0] ?? 0,
      lat: f.geometry?.coordinates?.[1] ?? 0,
      // Un résultat « housenumber » désigne une maison ; les autres, une rue
      // ou une commune — et cadrent donc à quelques dizaines de mètres près.
      precise: f.properties?.type === 'housenumber',
    }))
    .filter((a) => a.label && a.lat && a.lon)
}
