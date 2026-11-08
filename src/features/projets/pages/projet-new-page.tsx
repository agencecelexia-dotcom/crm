import { useDroits } from '@/lib/auth/use-droits'
import { useAuth } from '@/lib/auth/use-auth'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { ShieldCheck, Loader2 } from 'lucide-react'
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
  const { peutCreerLead } = useDroits()
  const { membreEnCours } = useAuth()
  const create = useCreateProjet()

  if (membreEnCours) return <div role="status" aria-label="Chargement des droits" className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
  if (!peutCreerLead) return <EmptyState icon={ShieldCheck} titre="Création non autorisée"
    description="Ton compte ne dispose pas du droit de création. Un fondateur peut modifier tes accès depuis l’équipe."
    action={<Button variant="outline" onClick={() => navigate('/projets')}>Retour aux projets</Button>} />

  return (
    <div className="mx-auto max-w-2xl">
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
