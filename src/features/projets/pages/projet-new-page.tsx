import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { ProjetForm } from '../components/projet-form'
import { useCreateProjet } from '../hooks/use-projets'

// Création d'un projet (formulaire d'appel rapide).
// Après création → fiche projet, où s'affichent immédiatement les artisans
// compatibles pour assigner en un tap.
export function ProjetNewPage() {
  const navigate = useNavigate()
  const create = useCreateProjet()

  return (
    <div>
      <PageHeader titre="Nouveau projet" sousTitre="Saisie pendant l'appel" back />
      <ProjetForm
        submitting={create.isPending}
        submitLabel="Créer le projet"
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (projet) => {
              toast.success('Projet créé', {
                description: 'Assigne un artisan compatible ci-dessous.',
              })
              navigate(`/projets/${projet.id}`, { replace: true })
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
