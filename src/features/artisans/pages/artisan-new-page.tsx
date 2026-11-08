import { useDroits } from '@/lib/auth/use-droits'
import { useAuth } from '@/lib/auth/use-auth'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { ArtisanForm } from '../components/artisan-form'
import { useCreateArtisan } from '../hooks/use-artisans'

// Création d'un artisan.
export function ArtisanNewPage() {
  const navigate = useNavigate()
  const { peutCreerArtisan } = useDroits()
  const { membreEnCours } = useAuth()
  const create = useCreateArtisan()

  if (membreEnCours) return <div role="status" aria-label="Chargement des droits" className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
  if (!peutCreerArtisan) return <EmptyState icon={ShieldCheck} titre="Création non autorisée"
    description="Ton compte ne dispose pas du droit de création. Un fondateur peut modifier tes accès depuis l’équipe."
    action={<Button variant="outline" onClick={() => navigate('/artisans')}>Retour aux artisans</Button>} />

  return (
    <div className="mx-auto max-w-2xl">
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
