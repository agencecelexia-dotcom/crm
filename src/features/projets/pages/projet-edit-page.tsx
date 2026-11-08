import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
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
  const { data: projet, isLoading, isError, refetch } = useProjet(id)
  const update = useUpdateProjet()

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !projet) {
    return <EmptyState icon={AlertCircle} titre="Fiche indisponible"
      description="Ce dossier est introuvable, inaccessible ou n’a pas pu être chargé."
      action={<div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => void refetch()}>Réessayer</Button>
        <Button variant="ghost" onClick={() => navigate('/projets')}>Retour aux projets</Button>
      </div>} />
  }

  return (
    <div className="mx-auto max-w-2xl">
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
