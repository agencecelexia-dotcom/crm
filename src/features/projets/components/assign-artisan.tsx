import { useState } from 'react'
import { UserPlus, MapPin, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/empty-state'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { artisansCompatibles } from '../lib/artisans-compatibles'
import { usePatchProjet } from '../hooks/use-projets'
import type { Artisan, ProjetAvecArtisan } from '@/types/database'

// Panneau d'assignation : liste les artisans du même métier, triés par proximité.
export function AssignArtisan({ projet }: { projet: ProjetAvecArtisan }) {
  const [open, setOpen] = useState(false)
  const { data: artisans } = useArtisans()
  const patch = usePatchProjet()

  const compatibles = artisansCompatibles(projet, artisans ?? [])

  function assigner(artisan: Artisan) {
    // Si le projet est encore "nouveau", on le fait passer en "artisan_assigné".
    // On reprend aussi le taux de commission par défaut de l'artisan.
    const base = { artisan_id: artisan.id, taux_commission: artisan.taux_commission }
    const patchData =
      projet.statut === 'nouveau'
        ? { ...base, statut: 'artisan_assigne' as const }
        : base

    patch.mutate(
      { id: projet.id, patch: patchData },
      {
        onSuccess: () => {
          toast.success('Artisan assigné')
          setOpen(false)
        },
        onError: (err) =>
          toast.error('Assignation impossible', {
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full">
          <UserPlus className="size-4" />
          {projet.artisan ? "Changer d'artisan" : 'Assigner un artisan'}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Assigner un artisan</SheetTitle>
          <SheetDescription>
            Tous les artisans
            {projet.metiers.length ? ` — métier « ${projet.metiers.join(' / ')} » d'abord` : ''},
            triés par proximité du client.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2 px-4 pb-8">
          {compatibles.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              titre="Aucun artisan en base"
              description="Ajoute un artisan depuis l'onglet Artisans pour pouvoir l'assigner."
            />
          ) : (
            compatibles.map(({ artisan, distance, dansRayon, metierMatch }) => {
              const estAssigne = artisan.id === projet.artisan_id
              return (
                <button
                  key={artisan.id}
                  type="button"
                  disabled={patch.isPending}
                  onClick={() => assigner(artisan)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent/50 disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {artisan.nom} {artisan.prenom}
                      {artisan.societe && (
                        <span className="text-muted-foreground"> · {artisan.societe}</span>
                      )}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" />
                      {artisan.ville || 'Ville inconnue'}
                      {distance != null && ` · ~${Math.round(distance)} km`}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {artisan.metiers.join(', ') || 'Aucun métier'}
                      {!metierMatch && projet.metiers.length > 0 && (
                        <span className="text-[#F59E0B]"> · autre métier</span>
                      )}
                    </p>
                  </div>
                  {estAssigne ? (
                    <Check className="size-5 shrink-0 text-primary" />
                  ) : dansRayon === false ? (
                    <Badge
                      className="shrink-0 border-transparent text-xs"
                      style={{ backgroundColor: '#F59E0B', color: '#fff' }}
                    >
                      hors rayon
                    </Badge>
                  ) : (
                    artisan.rayon_km && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {artisan.rayon_km} km
                      </Badge>
                    )
                  )}
                </button>
              )
            })
          )}
          {patch.isPending && (
            <div className="flex justify-center py-2">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
