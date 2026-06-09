import { useMemo, useState } from 'react'
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
import { cn } from '@/lib/utils'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { artisansCompatibles } from '../lib/artisans-compatibles'
import {
  useAffectations,
  useAffecterArtisans,
  useRetirerAffectation,
} from '../hooks/use-affectations'
import type { ProjetAvecArtisan } from '@/types/database'

// Assignation MULTIPLE : on confie le projet à un ou plusieurs artisans en
// parallèle. Chacun le verra de façon isolée (sans savoir qu'il y en a d'autres).
export function AssignArtisan({ projet }: { projet: ProjetAvecArtisan }) {
  const [open, setOpen] = useState(false)
  const { data: artisans } = useArtisans()
  const { data: affectations } = useAffectations(projet.id)
  const affecter = useAffecterArtisans()
  const retirer = useRetirerAffectation()
  const compatibles = artisansCompatibles(projet, artisans ?? [])

  const assignedIds = useMemo(
    () => new Set((affectations ?? []).map((a) => a.artisan_id)),
    [affectations],
  )
  const [selection, setSelection] = useState<Set<string>>(new Set())

  // Ouverture : on (ré)initialise la sélection sur les artisans déjà assignés.
  function changerOuverture(o: boolean) {
    setOpen(o)
    if (o) setSelection(new Set(assignedIds))
  }

  const busy = affecter.isPending || retirer.isPending
  const nb = affectations?.length ?? 0

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function enregistrer() {
    const toAdd = [...selection].filter((id) => !assignedIds.has(id))
    const toRemove = (affectations ?? []).filter((a) => !selection.has(a.artisan_id))
    try {
      if (toAdd.length) await affecter.mutateAsync({ projetId: projet.id, artisanIds: toAdd })
      for (const a of toRemove) await retirer.mutateAsync({ id: a.id, projetId: projet.id })
      toast.success('Assignation mise à jour')
      setOpen(false)
    } catch (e) {
      toast.error('Échec', { description: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <Sheet open={open} onOpenChange={changerOuverture}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full">
          <UserPlus className="size-4" />
          {nb > 0 ? `Gérer les artisans (${nb})` : 'Assigner des artisans'}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle>Assigner des artisans</SheetTitle>
          <SheetDescription>
            Coche un ou plusieurs artisans. Chacun verra le projet de façon isolée (sans savoir
            qu'il y en a d'autres).
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-2 overflow-y-auto px-4">
          {compatibles.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              titre="Aucun artisan en base"
              description="Ajoute un artisan depuis l'onglet Artisans pour pouvoir l'assigner."
            />
          ) : (
            compatibles.map(({ artisan, distance, dansRayon, metierMatch }) => {
              const checked = selection.has(artisan.id)
              return (
                <button
                  key={artisan.id}
                  type="button"
                  onClick={() => toggle(artisan.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40',
                    )}
                  >
                    {checked && <Check className="size-3.5" />}
                  </span>
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
                  {dansRayon === false ? (
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
        </div>

        <div className="border-t border-border p-4">
          <Button className="w-full" onClick={enregistrer} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Enregistrer l'assignation ({selection.size})
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
