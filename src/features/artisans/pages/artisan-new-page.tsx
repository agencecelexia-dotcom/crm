import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { ArtisanForm } from '../components/artisan-form'
import { useCreateArtisan } from '../hooks/use-artisans'

// Création d'un artisan.
export function ArtisanNewPage() {
  const navigate = useNavigate()
  const create = useCreateArtisan()

  return (
    <div>
      <PageHeader titre="Nouvel artisan" back />
      <ArtisanForm
        submitting={create.isPending}
        submitLabel="Créer l'artisan"
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (artisan) => {
              toast.success('Artisan créé')
              navigate(`/artisans/${artisan.id}`, { replace: true })
            },
            onError: (err) =>
              toast.error('Création impossible', {
                description: err instanceof Error ? err.message : undefined,
              }),
          })
        }
      />
    </div>
  )
}
