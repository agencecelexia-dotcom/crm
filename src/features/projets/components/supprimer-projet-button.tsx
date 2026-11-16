import { Loader2, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { supabase } from '@/lib/supabase/client'
import { supprimerPhoto, supprimerPieceProjet } from '@/lib/storage'
import type { Projet } from '@/types/database'
import { invaliderDonneesProjets } from '../lib/invalidation'

/**
 * Suppression DÉFINITIVE d'un projet saisi par erreur : la ligne et tout ce qui
 * en dépend disparaissent, plus rien ne le compte dans les statistiques.
 * Distinct de « Masquer », qui conserve le dossier. Les garde-fous (dossier
 * engagé, dossier d'un autre) sont tenus par `supprimer_projet_definitivement`.
 */
export function SupprimerProjetButton({ projet }: {
  projet: Pick<Projet, 'id' | 'client_nom' | 'photos'>
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: async () => {
      // Chemins relevés AVANT : après la suppression, les lignes n'existent plus.
      const { data: docs } = await supabase
        .from('projet_documents')
        .select('chemin')
        .eq('projet_id', projet.id)
      const { data, error } = await supabase.rpc('supprimer_projet_definitivement', {
        p_projet_id: projet.id,
      })
      if (error) throw error
      if (!(data as { ok?: boolean })?.ok) throw new Error('La suppression n’a pas été enregistrée.')
      // Fichiers au mieux : le projet est déjà effacé, un fichier restant
      // n'apparaît nulle part et ne doit pas faire croire à un échec.
      await Promise.allSettled([
        ...(projet.photos ?? []).map((url) => supprimerPhoto(url)),
        ...((docs ?? []) as { chemin: string }[]).map((d) => supprimerPieceProjet(d.chemin)),
      ])
    },
    onSuccess: () => {
      void invaliderDonneesProjets(qc)
      toast.success('Projet supprimé définitivement')
      navigate('/projets', { replace: true })
    },
    onError: (e) =>
      toast.error('Suppression impossible', {
        description: e instanceof Error ? e.message : undefined,
      }),
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={mutation.isPending}
          className="text-destructive hover:text-destructive"
          aria-label={`Supprimer définitivement ${projet.client_nom}`}>
          {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Supprimer
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer définitivement ce projet ?</AlertDialogTitle>
          <AlertDialogDescription>
            « {projet.client_nom} » sera effacé avec ses notes, photos et documents. Il ne
            comptera plus dans aucune statistique. Cette action est irréversible : pour
            simplement le sortir du pipeline, utilise plutôt « Masquer ».
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => mutation.mutate()}
          >
            Supprimer définitivement
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
