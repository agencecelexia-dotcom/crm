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

/** Devis rattachés à un projet (côté agence, accès authentifié). */
export function useDevisProjet(projetId: string | undefined) {
  return useQuery({
    queryKey: ['devis-projet', projetId],
    enabled: !!projetId,
    queryFn: async (): Promise<Devis[]> => {
      const { data, error } = await supabase
        .from('devis')
        .select(
          'id, numero, client_nom, objet, total, statut, pdf_url, date_devis, sent_at, projet_id',
        )
        .eq('projet_id', projetId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data as Devis[]) ?? []
    },
  })
}

/** Une ligne de la bibliothèque de prix de l'artisan (0132). */
export interface PrixArtisan {
  id: string
  designation: string
  unite: string
  prix_unitaire: number
  cout_unitaire: number | null
  metier: string | null
  utilisations: number
}

/**
 * Bibliothèque de prix de l'artisan.
 *
 * Elle se construit toute seule à l'usage : chaque devis enregistré y verse
 * ses lignes. Pas d'écran de gestion à tenir, et les prix les plus utilisés
 * remontent d'eux-mêmes.
 */
export function usePrixArtisan(token: string | undefined) {
  return useQuery({
    queryKey: ['devis-prix', token],
    enabled: !!token,
    queryFn: async (): Promise<PrixArtisan[]> => {
      const { data, error } = await supabase.rpc('prix_artisan_by_token', { p_token: token })
      if (error) throw error
      return (data as PrixArtisan[]) ?? []
    },
  })
}

/** Verse les lignes d'un devis dans la bibliothèque (appelé à l'enregistrement). */
export function useEnregistrerPrix(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ lignes, metier }: { lignes: unknown[]; metier?: string | null }) => {
      const { error } = await supabase.rpc('enregistrer_prix_by_token', {
        p_token: token,
        p_lignes: lignes,
        p_metier: metier ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis-prix', token] }),
  })
}

/** Une ligne proposée par l'IA à partir du dossier (edge `devis-suggerer`). */
export interface LigneSuggeree {
  designation: string
  unite: string
  quantite: number
  /** Toujours issu d'un catalogue — jamais inventé. Absent = prix à saisir. */
  prix_unitaire?: number | null
  source: 'bibliotheque' | 'reference' | 'aucune'
  pourquoi?: string
}

export interface Suggestions {
  ok: boolean
  error?: string
  metier?: string | null
  lignes?: LigneSuggeree[]
  /** Ce qui manque au dossier pour chiffrer sérieusement. */
  manques?: string[]
}

/**
 * Propose les lignes du devis à partir du chantier et des échanges.
 *
 * Le modèle choisit les désignations et estime les quantités ; les prix
 * viennent de la bibliothèque de l'artisan ou du référentiel, jamais de lui.
 */
export function useSuggestionsDevis(token: string | undefined) {
  return useMutation({
    mutationFn: async (affectationToken: string): Promise<Suggestions> => {
      const { data, error } = await supabase.functions.invoke('devis-suggerer', {
        body: { token, affectation_token: affectationToken },
      })
      if (error) throw error
      return data as Suggestions
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
  lignes: {
    designation: string
    quantite: number
    unite: string
    prix_unitaire: number
    // Déboursé et TVA (0132). Le déboursé ne sort jamais sur le PDF client :
    // il ne sert qu'à afficher la marge à l'artisan.
    cout_unitaire?: number | null
    tva_taux?: number
  }[]
  tva_mode?: string
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

/** Enregistre l'URL du PDF généré sur le devis (+ rafraîchit « Mes devis »). */
export function useSetDevisPdf(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, url }: { id: string; url: string }) => {
      const { error } = await supabase.rpc('set_devis_pdf_by_token', {
        p_token: token,
        p_devis_id: id,
        p_url: url,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis', token] }),
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(((reader.result as string) || '').split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Envoie le devis (PDF en PIÈCE JOINTE) à l'email de l'artisan, via n8n. */
export async function envoyerDevisPdfEmail(p: {
  email: string
  numero: string
  client_nom?: string | null
  pdf: Blob
}) {
  const pdf_base64 = await blobToBase64(p.pdf)
  await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'envoyer_devis_pdf',
      email: p.email,
      numero: p.numero,
      filename: `devis-${p.numero}.pdf`,
      subject: `Votre devis ${p.numero}${p.client_nom ? ' — ' + p.client_nom : ''}`,
      html: `<p>Bonjour,</p><p>Voici votre devis <b>${p.numero}</b>${
        p.client_nom ? ' pour <b>' + p.client_nom + '</b>' : ''
      } en pièce jointe (PDF).</p><p>— Celexia</p>`,
      pdf_base64,
    }),
  })
}

/** Une ligne telle qu'elle vit dans un modèle ou dans un devis dupliqué. */
export interface LigneModele {
  designation: string
  unite: string | null
  quantite: number | null
  prix_unitaire: number | null
  cout_unitaire: number | null
}

/**
 * Un modèle de devis (0135).
 *
 * `source` dit d'où il vient : `perso` pour ceux que l'artisan a enregistrés,
 * `reference` pour le devis type du métier, déduit des devis réellement
 * observés. Le second n'a pas d'`id` — il est recalculé à chaque appel.
 */
export interface ModeleDevis {
  id: string | null
  nom: string
  metier: string | null
  lignes: LigneModele[]
  nb_lignes: number
  source: 'perso' | 'reference'
}

export function useModelesDevis(token: string | undefined, metier?: string | null) {
  return useQuery({
    queryKey: ['devis-modeles', token, metier ?? null],
    enabled: !!token,
    queryFn: async (): Promise<ModeleDevis[]> => {
      const { data, error } = await supabase.rpc('modeles_by_token', {
        p_token: token,
        p_metier: metier ?? null,
      })
      if (error) throw error
      return (data as ModeleDevis[]) ?? []
    },
  })
}

export function useEnregistrerModele(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { nom: string; lignes: LigneModele[]; metier?: string | null }) => {
      const { data, error } = await supabase.rpc('enregistrer_modele_by_token', {
        p_token: token,
        p_nom: p.nom,
        p_lignes: p.lignes,
        p_metier: p.metier ?? null,
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) throw new Error(r.error)
      return r
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis-modeles', token] }),
  })
}

export function useSupprimerModele(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('supprimer_modele_by_token', {
        p_token: token,
        p_id: id,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis-modeles', token] }),
  })
}

/** Reprend les lignes d'un devis déjà fait — deux chantiers se ressemblent souvent. */
export function useDupliquerDevis(token: string | undefined) {
  return useMutation({
    mutationFn: async (devisId: string) => {
      const { data, error } = await supabase.rpc('dupliquer_devis_by_token', {
        p_token: token,
        p_devis_id: devisId,
      })
      if (error) throw error
      const r = data as {
        ok: boolean
        error?: string
        objet?: string | null
        lignes?: LigneModele[]
        tva_mode?: string | null
        conditions?: string | null
      }
      if (!r.ok) throw new Error(r.error)
      return r
    },
  })
}

/** Une question posée par l'entretien (0140, edge `devis-entretien`). */
export interface QuestionEntretien {
  cle: string
  libelle: string
  type: 'nombre' | 'choix' | 'texte'
  unite?: string | null
  options?: string[] | null
  defaut?: string | null
  pourquoi?: string | null
}

export interface ReponseQuestions {
  ok: boolean
  error?: string
  objet?: string | null
  metier?: string | null
  questions?: QuestionEntretien[]
}

export interface LigneEntretien extends LigneModele {
  source: 'bibliotheque' | 'reference' | 'marge' | 'a_chiffrer'
}

export interface ReponseLignes {
  ok: boolean
  error?: string
  objet?: string | null
  lignes?: LigneEntretien[]
  hypotheses?: string[]
  manques?: string[]
}

/**
 * Le devis par entretien : l'artisan décrit, le modèle questionne, le devis
 * sort chiffré.
 *
 * Le modèle ne voit aucun prix et son outil n'a pas de champ de prix : il ne
 * peut pas en inventer. Les prix sont attachés en base, depuis la bibliothèque
 * de l'artisan puis le référentiel du métier.
 */
export function useEntretienDevis(token: string | undefined) {
  return useMutation({
    mutationFn: async (p: {
      phase: 'questions' | 'lignes'
      description: string
      metier?: string | null
      affectation_token?: string | null
      reponses?: Record<string, string>
      marge?: number | null
    }): Promise<ReponseQuestions & ReponseLignes> => {
      const { data, error } = await supabase.functions.invoke('devis-entretien', {
        body: { token, ...p },
      })
      if (error) throw error
      return data as ReponseQuestions & ReponseLignes
    },
  })
}
