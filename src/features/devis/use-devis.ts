import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { N8N_WEBHOOK_URL } from '@/lib/constants'
import type { Devis } from '@/types/database'

/** Liste des devis de l'artisan (token d'espace). */
export function useListeDevis(token: string | undefined) {
  return useQuery({
    queryKey: ['devis', token],
    enabled: !!token,
    queryFn: async (): Promise<Devis[]> => {
      const { data, error } = await supabase.rpc('list_devis_by_token', { p_token: token })
      if (error) throw error
      return (data as Devis[]) ?? []
    },
  })
}

export interface DevisPayload {
  affectation_token?: string
  client_nom?: string
  client_adresse?: string
  client_cp?: string
  client_ville?: string
  client_email?: string
  client_tel?: string
  objet?: string
  lignes: { designation: string; quantite: number; unite: string; prix_unitaire: number }[]
  total: number
  acompte_pct?: number | null
  conditions?: string
  notes?: string
  date_validite?: string | null
}

/** Crée le devis en base (numéro attribué côté serveur). */
export function useCreerDevis(token: string | undefined) {
  return useMutation({
    mutationFn: async (payload: DevisPayload): Promise<{ id: string; numero: string }> => {
      const { data, error } = await supabase.rpc('creer_devis_by_token', {
        p_token: token,
        p_payload: payload,
      })
      const r = data as { ok?: boolean; id?: string; numero?: string } | null
      if (error || !r?.ok) throw new Error('Création du devis impossible')
      return { id: r.id!, numero: r.numero! }
    },
  })
}

/** Enregistre l'URL du PDF généré sur le devis. */
export function useSetDevisPdf(token: string | undefined) {
  return useMutation({
    mutationFn: async ({ id, url }: { id: string; url: string }) => {
      const { error } = await supabase.rpc('set_devis_pdf_by_token', {
        p_token: token,
        p_devis_id: id,
        p_url: url,
      })
      if (error) throw error
    },
  })
}

/** Marque le devis comme envoyé (+ répercussion CRM) et renvoie de quoi mailer. */
export function useEnvoyerDevis(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      id: string,
    ): Promise<{ client_email: string | null; numero: string; total: number; pdf_url: string | null }> => {
      const { data, error } = await supabase.rpc('envoyer_devis_by_token', {
        p_token: token,
        p_devis_id: id,
      })
      const r = data as
        | { ok?: boolean; client_email: string | null; numero: string; total: number; pdf_url: string | null }
        | null
      if (error || !r?.ok) throw new Error('Envoi impossible')
      return r
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis', token] })
      qc.invalidateQueries({ queryKey: ['espace', token] })
    },
  })
}

/** Envoie l'email du devis au client (lien vers le PDF) via n8n. */
export async function envoyerDevisEmail(p: {
  email: string
  client_nom?: string | null
  artisan: string
  numero: string
  montant: number
  lien: string
}) {
  await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'envoyer_devis', ...p }),
  })
}
