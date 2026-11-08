import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ArtisanForm } from '../components/artisan-form'
import { useArtisan, useUpdateArtisan } from '../hooks/use-artisans'

// Modification d'un artisan existant.
export function ArtisanEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: artisan, isLoading, isError, refetch } = useArtisan(id)
  const update = useUpdateArtisan()

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !artisan) {
    return <EmptyState icon={AlertCircle} titre="Fiche indisponible"
      description="Ce dossier est introuvable, inaccessible ou n’a pas pu être chargé."
      action={<div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => void refetch()}>Réessayer</Button>
        <Button variant="ghost" onClick={() => navigate('/artisans')}>Retour aux artisans</Button>
      </div>} />
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader titre="Modifier l'artisan" back />
      <ArtisanForm
        artisan={artisan}
        submitting={update.isPending}
        submitLabel="Enregistrer les modifications"
        onSubmit={(input) =>
          update.mutate(
            { id: artisan.id, input },
            {
              onSuccess: () => {
                toast.success('Artisan mis à jour')
                navigate(`/artisans/${artisan.id}`, { replace: true })
              },
              onError: (err) =>
                toast.error('Mise à jour impossible', {
                  description: err instanceof Error ? err.message : undefined,
                }),
            },
          )
        }
      />
    </div>
  )
}
