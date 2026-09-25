import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Point } from './geometrie'
import { messageMetre, type Adresse } from './use-metres'

/**
 * LA maison du chantier, désignée par le serveur (`batiment-chantier`).
 *
 * Elle remplace « le bâtiment dont le centre est le plus proche du point
 * d'adresse », qui désignait la maison d'en face dès que le point tombait sur
 * la chaussée. Le Référentiel national des bâtiments relie officiellement
 * l'adresse à son bâtiment ; sinon, l'écran demande confirmation.
 */
export type Confiance = 'confirmee' | 'officielle' | 'a_confirmer' | 'aucune'

export interface MaisonChantier {
  ok: true
  confiance: Confiance
  methode: 'confirmee' | 'rnb' | 'contenant' | 'proximite' | null
  principal: { cleabs: string; contour: Point[]; aire: number } | null
  /** Les autres bâtiments de la même adresse (garage, annexe). */
  autres: string[]
  point: Point | null
  adresse_retrouvee: string | null
  score: number | null
  commune_saisie: string | null
  commune_retrouvee: string | null
  commune_differente: boolean
  /** Le numéro saisi, quand la BAN en a retrouvé un autre dans la même rue. */
  numero_saisi: string | null
  message: string | null
}

/**
 * Au-delà, on renonce et l'écran retombe sur la lecture de l'adresse dans le
 * navigateur : l'artisan ne doit pas attendre une carte vide parce que l'IGN
 * ou le RNB traînent.
 */
const DELAI_MS = 12_000

async function identifier(
  corps: { token: string; affectation_token: string; adresse?: { id: string; label: string; point: Point } },
  signal?: AbortSignal,
): Promise<MaisonChantier> {
  const ctrl = new AbortController()
  const minuterie = setTimeout(() => ctrl.abort(), DELAI_MS)
  const relayer = () => ctrl.abort()
  signal?.addEventListener('abort', relayer)
  try {
    const { data, error } = await supabase.functions.invoke('batiment-chantier', { body: corps, signal: ctrl.signal })
    if (error) throw error
    const r = data as MaisonChantier | { ok: false; error?: string }
    if (!r.ok) throw new Error(messageMetre(r.error))
    return r
  } finally {
    clearTimeout(minuterie)
    signal?.removeEventListener('abort', relayer)
  }
}

export const cleMaison = (token: string | undefined, affectationToken: string) =>
  ['batiment-chantier', token ?? null, affectationToken] as const

/** La maison de l'adresse du dossier — mémorisée côté serveur une fois confirmée. */
export function useMaisonChantier(token: string | undefined, affectationToken: string, actif: boolean) {
  return useQuery({
    queryKey: cleMaison(token, affectationToken),
    enabled: !!token && actif,
    staleTime: 1000 * 60 * 30,
    // Revenir sur l'onglet ne doit pas déplacer la carte sous le doigt.
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: ({ signal }) => identifier({ token: token!, affectation_token: affectationToken }, signal),
  })
}

/** La maison d'une adresse cherchée à la main. Rien n'est retenu avant le « Oui » de l'artisan. */
export function maisonDeLAdresse(token: string, affectationToken: string, a: Adresse, signal?: AbortSignal) {
  return identifier(
    { token, affectation_token: affectationToken, adresse: { id: a.id, label: a.label, point: [a.lon, a.lat] } },
    signal,
  )
}

/**
 * « C'est bien la maison. » La réponse est gardée sur le projet : l'agence et
 * l'artisan verront la même, et elle ne sera plus redemandée.
 */
export function useRetenirMaison(token: string | undefined, affectationToken: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { cleabs: string; point: Point | null; contour: Point[]; aire: number }) => {
      const { data, error } = await supabase.rpc('retenir_batiment_by_token', {
        p_token: token,
        p_affectation_token: affectationToken,
        p_cleabs: p.cleabs,
        p_confirme: true,
        p_lon: p.point ? Number(p.point[0].toFixed(7)) : null,
        p_lat: p.point ? Number(p.point[1].toFixed(7)) : null,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) throw new Error(messageMetre(r.error))
    },
    // Ce que le serveur répondra désormais, sans le rappeler : cette maison,
    // confirmée. Rouvrir la feuille la présélectionne aussitôt.
    onSuccess: (_, p) =>
      qc.setQueryData<MaisonChantier>(cleMaison(token, affectationToken), (avant) =>
        avant
          ? {
              ...avant,
              confiance: 'confirmee',
              methode: 'confirmee',
              principal: { cleabs: p.cleabs, contour: p.contour, aire: Math.round(p.aire) },
              point: p.point ?? avant.point,
              message: null,
            }
          : avant,
      ),
  })
}
