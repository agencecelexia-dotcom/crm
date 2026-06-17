import { Link } from 'react-router-dom'
import { Trash2, RotateCcw, Loader2, ArchiveX } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import { formatDate } from '@/lib/format'
import {
  useProjetsSupprimes,
  useRestaurerProjet,
  useSupprimerDefinitivement,
} from '../hooks/use-projets'

// Corbeille : projets supprimés, restaurables ou à effacer définitivement.
export function CorbeillePage() {
  const { data: projets, isLoading } = useProjetsSupprimes()
  const restaurer = useRestaurerProjet()
  const supprimer = useSupprimerDefinitivement()

  return (
    <div>
      <PageHeader
        titre="Corbeille"
        sousTitre="Projets supprimés — restaurables tant qu'ils ne sont pas effacés définitivement"
        action={
          <Button asChild variant="outline">
            <Link to="/projets">← Projets</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : !projets || projets.length === 0 ? (
        <EmptyState
          icon={ArchiveX}
          titre="Corbeille vide"
          description="Les projets que tu supprimes atterrissent ici et peuvent être restaurés."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {projets.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.client_nom}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.metiers?.join(', ') || p.metier || '—'}
                    {p.client_ville && ` · ${p.client_ville}`}
                  </p>
                  {p.deleted_at && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Supprimé le {formatDate(p.deleted_at)}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={restaurer.isPending}
                    onClick={() =>
                      restaurer.mutate(p.id, {
                        onSuccess: () => toast.success('Projet restauré'),
                        onError: (e) =>
                          toast.error('Échec', {
                            description: e instanceof Error ? e.message : undefined,
                          }),
                      })
                    }
                  >
                    {restaurer.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    Restaurer
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer définitivement ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          « {p.client_nom} » sera effacé pour de bon, sans possibilité de
                          restauration. Cette action est irréversible.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={() =>
                            supprimer.mutate(p.id, {
                              onSuccess: () => toast.success('Supprimé définitivement'),
                              onError: (e) =>
                                toast.error('Échec', {
                                  description: e instanceof Error ? e.message : undefined,
                                }),
                            })
                          }
                        >
                          Supprimer définitivement
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
