import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { N8N_WEBHOOK_URL } from '@/lib/constants'
import type { Devis } from '@/types/database'
import type { DevisData } from './devis-pdf'

type DevisListe = Devis & { revision?: number; envoi_etat?: string | null }

/** Liste des devis de l'artisan (token d'espace). */
export function useListeDevis(token: string | undefined) {
  return useQuery({
    queryKey: ['devis', token],
    enabled: !!token,
    queryFn: async (): Promise<DevisListe[]> => {
      const { data, error } = await supabase.rpc('list_devis_by_token', { p_token: token })
      if (error) throw error
      return (data as DevisListe[]) ?? []
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
  devis_id?: string
  expected_revision?: number
  idempotency_key?: string
  document_data?: DevisData
  email_html?: string
  email_subject?: string
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: DevisPayload): Promise<{ id: string; numero: string; revision: number }> => {
      // Une ancienne RPC ignore devis_id/idempotency_key : découvrir son
      // incompatibilité APRÈS l'appel aurait déjà réservé un autre numéro.
      // Lecture à chaque tentative, sans cache positif pendant le déploiement.
      const { data: capacites, error: erreurCapacites } = await supabase.rpc('capacites_devis_by_token', {
        p_token: token,
      })
      const support = capacites as { ok?: boolean; version?: number; sauvegarde_idempotente?: boolean; revisions?: boolean; error?: string } | null
      if (erreurCapacites || support?.ok !== true || support.version !== 2 || support.sauvegarde_idempotente !== true || support.revisions !== true) {
        throw new Error(messageDevis(support?.error) ?? 'La sauvegarde des devis est temporairement indisponible pendant la mise à jour. Vos saisies sont conservées. Réessayez plus tard.')
      }
      const { data, error } = await supabase.rpc('creer_devis_by_token', {
        p_token: token,
        p_payload: payload,
      })
      const r = data as { ok?: boolean; id?: string; numero?: string; revision?: number; error?: string } | null
      if (error || !r?.ok || !r.id || !r.numero || typeof r.revision !== 'number') throw new Error(messageDevis(r?.error) ?? error?.message ?? 'Sauvegarde du devis impossible')
      return { id: r.id, numero: r.numero, revision: r.revision }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis', token] }),
  })
}

/** Enregistre l'URL du PDF généré sur le devis (+ rafraîchit « Mes devis »). */
export function useSetDevisPdf(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, url, revision }: { id: string; url: string; revision: number }) => {
      const { data, error } = await supabase.rpc('set_devis_pdf_by_token', {
        p_token: token,
        p_devis_id: id,
        p_url: url,
        p_revision: revision,
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error(messageDevis((data as { error?: string })?.error) ?? error?.message ?? 'Le PDF n’a pas pu être rattaché au brouillon. Réessayez.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis', token] }),
  })
}

/** L'endpoint vérifie les droits, réserve l'envoi puis attend un accusé serveur. */
export function useEnvoyerDevis(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, revision }: { id: string; revision: number }) => {
      const { data, error } = await supabase.functions.invoke('devis-envoyer', { body: { token, devis_id: id, revision } })
      const r = data as { ok?: boolean; error?: string; deja_envoye?: boolean } | null
      if (error || !r?.ok) throw new Error(messageDevis(r?.error) ?? 'Envoi non confirmé. Le devis est conservé. Vérifiez son état avant de réessayer.')
      return r
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['devis', token] })
      void qc.invalidateQueries({ queryKey: ['espace', token] })
    },
  })
}

export type BrouillonDevis = DevisPayload & {
  id: string; numero: string; revision: number; statut: string; envoi_etat?: string | null
}

export function useReprendreDevis(token: string) {
  return useMutation({
    mutationFn: async (id: string): Promise<BrouillonDevis> => {
      const { data, error } = await supabase.rpc('devis_by_token', { p_token: token, p_devis_id: id })
      const r = data as { ok?: boolean; error?: string; devis?: BrouillonDevis } | null
      if (error || !r?.ok || !r.devis) throw new Error(messageDevis(r?.error) ?? 'Ce brouillon ne peut pas être ouvert. Réessayez.')
      return r.devis
    },
  })
}

function messageDevis(code?: string): string | undefined {
  const messages: Record<string, string> = {
    revision_conflit: 'Ce brouillon a été modifié dans un autre onglet. Vos saisies restent affichées ; fermez puis reprenez la dernière version avant de continuer.',
    devis_verrouille: 'Ce devis est déjà envoyé et ne peut plus être modifié.',
    envoi_a_verifier: 'La prise en charge de cet envoi reste à vérifier auprès de Celexia. Aucun nouvel email n’a été envoyé.',
    chiffrage_non_active: 'Vos assurances doivent être validées avant de créer un devis.',
    valeurs_invalides: 'Vérifiez les quantités, prix, taux et acompte du devis.',
    client_requis: 'Indiquez le nom du client.',
    email_invalide: 'Vérifiez l’adresse email du client.',
    pdf_requis: 'Enregistrez le PDF du devis avant de l’envoyer.',
    service_non_configure: 'Le service d’envoi n’est pas disponible. Votre brouillon et son PDF restent enregistrés.',
  }
  return code ? messages[code] : undefined
}

function echapperHtml(texte: string) {
  return texte.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
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
  const response = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'envoyer_devis_pdf',
      email: p.email,
      numero: p.numero,
      filename: `devis-${p.numero}.pdf`,
      subject: `Votre devis ${p.numero}${p.client_nom ? ' — ' + p.client_nom : ''}`,
      html: `<p>Bonjour,</p><p>Voici votre devis <b>${echapperHtml(p.numero)}</b>${
        p.client_nom ? ' pour <b>' + echapperHtml(p.client_nom) + '</b>' : ''
      } en pièce jointe (PDF).</p><p>— Celexia</p>`,
      pdf_base64,
    }),
  })
  if (!response.ok || response.type === 'opaque') throw new Error('Envoi non confirmé par le serveur')
}

/**
 * Envoie le devis AU CLIENT : le HTML dans le corps du message, le PDF en
 * pièce jointe.
 *
 * Le client lit le corps, souvent sur un téléphone, souvent sans ouvrir la
 * pièce jointe. C'est donc le HTML qui décide si le devis est lu — mais c'est
 * le PDF qui fait foi, et le message le dit.
 */
export async function envoyerDevisAuClient(p: {
  email: string
  numero: string
  sujet: string
  html: string
  pdf: Blob
}) {
  const pdf_base64 = await blobToBase64(p.pdf)
  const response = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'envoyer_devis_client',
      email: p.email,
      numero: p.numero,
      filename: `devis-${p.numero}.pdf`,
      subject: p.sujet,
      html: p.html,
      pdf_base64,
    }),
  })
  if (!response.ok || response.type === 'opaque') throw new Error('Envoi non confirmé par le serveur')
}

/** Une ligne telle qu'elle vit dans un modèle ou dans un devis dupliqué. */
export interface LigneModele {
  designation: string
  unite: string | null
  quantite: number | null
  prix_unitaire: number | null
  cout_unitaire: number | null
  /** Taux de la ligne : un chantier mêle 10 % et 20 %, et reprendre un devis
   *  sans lui ramenait tout à 10 %. */
  tva_taux?: number | null
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
      const { data, error } = await supabase.rpc('supprimer_modele_by_token', {
        p_token: token,
        p_id: id,
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Suppression impossible')
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
  /** Nombre de devis derrière un prix de référence (0163). */
  observations?: number | null
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
