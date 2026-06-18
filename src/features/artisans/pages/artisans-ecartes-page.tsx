import { Link } from 'react-router-dom'
import { RotateCcw, Loader2, ShieldOff, Trash2 } from 'lucide-react'
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
import { useArtisansEcartes, useReactiverArtisan, useDeleteArtisan } from '../hooks/use-artisans'

// Artisans écartés (« pas fiables ») : conservés à part, réactivables.
export function ArtisansEcartesPage() {
  const { data: artisans, isLoading } = useArtisansEcartes()
  const reactiver = useReactiverArtisan()
  const supprimer = useDeleteArtisan()

  return (
    <div>
      <PageHeader
        titre="Artisans écartés"
        sousTitre="« Pas fiables » — conservés pour ne pas les recontacter, réactivables à tout moment"
        action={
          <Button asChild variant="outline">
            <Link to="/artisans">← Artisans</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !artisans || artisans.length === 0 ? (
        <EmptyState
          icon={ShieldOff}
          titre="Aucun artisan écarté"
          description="Les artisans peu fiables que tu écartes atterrissent ici, conservés sans être recontactés."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {artisans.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-col gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.societe ?? `${a.nom} ${a.prenom ?? ''}`}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.metiers?.join(', ') || '—'}
                    {a.ville && ` · ${a.ville}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Écarté{a.ecarte_at ? ` le ${formatDate(a.ecarte_at)}` : ''}
                    {a.ecarte_motif ? ` — ${a.ecarte_motif}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={reactiver.isPending}
                    onClick={() =>
                      reactiver.mutate(a.id, {
                        onSuccess: () => toast.success('Artisan réactivé'),
                        onError: (e) =>
                          toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
                      })
                    }
                  >
                    {reactiver.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    Réactiver
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
                          « {a.societe ?? a.nom} » sera effacé pour de bon (impossible à restaurer).
                          En général, mieux vaut le laisser dans cette liste pour ne pas le
                          recontacter par erreur.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={() =>
                            supprimer.mutate(a.id, {
                              onSuccess: () => toast.success('Supprimé définitivement'),
                              onError: (e) =>
                                toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
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
