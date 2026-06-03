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
  const { data: artisan, isLoading } = useArtisan(id)
  const update = useUpdateArtisan()

  if (isLoading || !artisan) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
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
