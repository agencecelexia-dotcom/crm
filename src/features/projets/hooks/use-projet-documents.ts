import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase/client'
import { supprimerPieceProjet, uploaderPieceProjet } from '@/lib/storage'
import type { ProjetDocument } from '@/types/database'

// Pièces jointes libres d'un projet (table projet_documents + bucket privé
// `documents`). Distinct des 3 emplacements fixes contrat/devis/devis signé,
// qui restent portés par des colonnes de `projets`.

const cle = (projetId: string) => ['projets', projetId, 'documents'] as const

export function useProjetDocuments(projetId: string | undefined) {
  return useQuery({
    queryKey: cle(projetId ?? ''),
    enabled: !!projetId,
    queryFn: async (): Promise<ProjetDocument[]> => {
      const { data, error } = await supabase
        .from('projet_documents')
        .select('*')
        .eq('projet_id', projetId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ProjetDocument[]
    },
  })
}

export function useAjouterDocuments(projetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (files: File[]) => {
      // Uploads en parallèle : sur une liaison mobile, les enchaîner en série
      // rendait l'ajout de plusieurs pièces inutilement long.
      const lignes = await Promise.all(
        files.map(async (file) => ({
          projet_id: projetId,
          nom: file.name,
          chemin: await uploaderPieceProjet(projetId, file),
          taille_octets: file.size,
          // Peut être vide sur certains navigateurs mobiles (.heic, .mov pris
          // depuis l'appareil photo) ; l'affichage retombe alors sur l'extension.
          type_mime: file.type || null,
          // Partagé par défaut : le cas courant est justement de transmettre
          // ces pièces à l'artisan. L'agence peut retirer le partage ensuite.
          visible_artisan: true,
        })),
      )
      const { error } = await supabase.from('projet_documents').insert(lignes)
      if (error) throw error
      return lignes.length
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: cle(projetId) })
      toast.success(n > 1 ? `${n} documents ajoutés` : 'Document ajouté')
    },
    onError: (e) =>
      toast.error("Ajout impossible", {
        description: e instanceof Error ? e.message : undefined,
      }),
  })
}

/**
 * Bascule le partage d'une pièce avec l'artisan.
 *
 * Mise à jour optimiste : c'est une case à cocher, et attendre l'aller-retour
 * réseau pour la voir bouger donnerait l'impression d'un clic perdu.
 */
export function useBasculerPartage(projetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      const { error } = await supabase
        .from('projet_documents')
        .update({ visible_artisan: visible })
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, visible }) => {
      await qc.cancelQueries({ queryKey: cle(projetId) })
      const avant = qc.getQueryData<ProjetDocument[]>(cle(projetId))
      qc.setQueryData<ProjetDocument[]>(cle(projetId), (docs) =>
        docs?.map((d) => (d.id === id ? { ...d, visible_artisan: visible } : d)),
      )
      return { avant }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.avant) qc.setQueryData(cle(projetId), ctx.avant)
      toast.error('Partage non modifié', {
        description: e instanceof Error ? e.message : undefined,
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cle(projetId) }),
  })
}

export function useSupprimerDocument(projetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (doc: ProjetDocument) => {
      // Le fichier d'abord : si l'on supprimait la ligne en premier et que le
      // retrait du bucket échouait, l'objet deviendrait orphelin et invisible.
      // Dans l'ordre inverse, un échec laisse la ligne — donc réessayable.
      await supprimerPieceProjet(doc.chemin)
      const { error } = await supabase.from('projet_documents').delete().eq('id', doc.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cle(projetId) })
      toast.success('Document supprimé')
    },
    onError: (e) =>
      toast.error('Suppression impossible', {
        description: e instanceof Error ? e.message : undefined,
      }),
  })
}
