import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ProjetForm } from '../components/projet-form'
import { useProjet, useUpdateProjet } from '../hooks/use-projets'

// Modification des informations d'un projet (client, demande, budget).
export function ProjetEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: projet, isLoading } = useProjet(id)
  const update = useUpdateProjet()

  if (isLoading || !projet) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader titre="Modifier le projet" back />
      <ProjetForm
        projet={projet}
        submitting={update.isPending}
        submitLabel="Enregistrer les modifications"
        onSubmit={(input) =>
          update.mutate(
            { id: projet.id, input },
            {
              onSuccess: () => {
                toast.success('Projet mis à jour')
                navigate(`/projets/${projet.id}`, { replace: true })
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
