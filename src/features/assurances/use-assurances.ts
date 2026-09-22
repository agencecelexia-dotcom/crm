import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { uploaderAssurance } from '@/lib/storage'

// ------------------------------------------------------------
//  Assurances de l'artisan : dépôt, lecture par Claude, validation agence.
//
//  C'est ce qui ouvre le générateur de devis (0131). Tant que les deux
//  attestations ne sont pas déposées ET validées, l'artisan ne chiffre pas.
// ------------------------------------------------------------

export type TypeAssurance = 'decennale' | 'rc_pro'

export interface PieceAssurance {
  deposee: boolean
  assureur: string | null
  police: string | null
  echeance: string | null
  expiree: boolean
}

export interface EtatChiffrage {
  peut_chiffrer: boolean
  validees_le: string | null
  decennale: PieceAssurance
  rc_pro: PieceAssurance
}

/** Ce que Claude a lu sur l'attestation — à corriger par l'artisan avant envoi. */
export interface LectureAssurance {
  ok: boolean
  error?: string
  type_document?: 'decennale' | 'rc_pro' | 'les_deux' | 'autre'
  assureur?: string
  numero_police?: string
  echeance?: string
  assure?: string
  activites?: string
  confiance?: number
}

/** État du déblocage, vu depuis l'espace artisan (jeton, pas de compte). */
export function useEtatChiffrage(token: string | undefined) {
  return useQuery({
    queryKey: ['chiffrage', token],
    enabled: !!token,
    queryFn: async (): Promise<EtatChiffrage | null> => {
      const { data, error } = await supabase.rpc('etat_chiffrage_by_token', { p_token: token })
      if (error) throw error
      return (data as EtatChiffrage) ?? null
    },
  })
}

/** Convertit un fichier en base64 nu (sans le préfixe `data:`). */
function enBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader()
    lecteur.onload = () => resolve(String(lecteur.result).split(',')[1] ?? '')
    lecteur.onerror = () => reject(new Error('Lecture du fichier impossible'))
    lecteur.readAsDataURL(file)
  })
}

/**
 * Fait lire l'attestation par Claude.
 *
 * L'échec n'est pas bloquant : si la lecture ne donne rien, l'artisan saisit
 * les champs à la main. Mieux vaut un formulaire vide qu'un dépôt refusé.
 */
export function useLireAssurance(token: string | undefined) {
  return useMutation({
    mutationFn: async (file: File): Promise<LectureAssurance> => {
      const fichier = await enBase64(file)
      const { data, error } = await supabase.functions.invoke('assurance-lire', {
        body: { token, fichier, mime: file.type },
      })
      if (error) throw error
      return data as LectureAssurance
    },
  })
}

export interface DepotAssurance {
  type: TypeAssurance
  file: File
  assureur?: string
  police?: string
  echeance?: string | null
}

/** Téléverse la pièce puis l'enregistre sur la fiche artisan. */
export function useDeposerAssurance(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, file, assureur, police, echeance }: DepotAssurance) => {
      const chemin = await uploaderAssurance(token!, type, file)
      const { data, error } = await supabase.rpc('deposer_assurance_by_token', {
        p_token: token,
        p_type: type,
        p_url: chemin,
        p_assureur: assureur || null,
        p_police: police || null,
        p_echeance: echeance || null,
      })
      if (error) throw error
      const r = data as { ok?: boolean; error?: string; echeance?: string }
      if (!r?.ok) throw new Error(MESSAGES[r?.error ?? ''] ?? r?.error ?? 'Dépôt impossible')
      return r
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chiffrage', token] }),
  })
}

/** Refus du serveur traduits en langage compréhensible. */
const MESSAGES: Record<string, string> = {
  token_invalide: 'Lien invalide — rechargez la page.',
  type_invalide: 'Type d’assurance inconnu.',
  fichier_requis: 'Aucun fichier reçu.',
  attestation_expiree: 'Cette attestation est déjà expirée : déposez la plus récente.',
}

/** Côté agence : valide (ou retire la validation) des assurances d'un artisan. */
export function useValiderAssurances() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, valide }: { id: string; valide: boolean }) => {
      const { data, error } = await supabase.rpc('valider_assurances', {
        p_artisan_id: id,
        p_valide: valide,
      })
      if (error) throw error
      const r = data as { ok?: boolean; error?: string }
      if (!r?.ok) {
        throw new Error(
          r?.error === 'pieces_manquantes'
            ? 'Les deux attestations doivent être déposées.'
            : r?.error === 'reserve_fondateur'
              ? 'Réservé aux fondateurs.'
              : (r?.error ?? 'Échec'),
        )
      }
      return r
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['artisans'] })
      qc.invalidateQueries({ queryKey: ['artisans', id] })
    },
  })
}
