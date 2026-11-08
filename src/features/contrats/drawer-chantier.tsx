import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatutArtisan } from './statut-artisan'
import { formatEuros } from '@/lib/format'
import { CorpsChantier } from './corps-chantier'
import type { ProjetEspace } from '@/types/database'

/**
 * Détail d'un chantier en panneau latéral.
 *
 * L'accordéon poussait tout le reste vers le bas sur 3 à 4 écrans : on perdait
 * le contexte et sa position dans la liste (audit §6). Le panneau conserve la
 * liste visible derrière et se ferme sans faire sauter le défilement.
 *
 * Même contenu que l'accordéon — `CorpsChantier` est partagé, il n'y a pas
 * deux rendus à maintenir en parallèle.
 */
export function DrawerChantier({
  projet,
  signe,
  onClose,
  onChange,
  onCreerDevis,
  onMesurer,
}: {
  projet: ProjetEspace | null
  signe: boolean
  onClose: () => void
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
  onMesurer?: (p: ProjetEspace) => void
}) {
  if (!projet) return null

  const metiers = projet.metiers?.length ? projet.metiers : [projet.metier]
  const adresse = [projet.client_adresse, projet.client_code_postal, projet.client_ville]
    .filter(Boolean)
    .join(', ')
  const montant = projet.montant_devis_signe ?? projet.montant_devis

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="h-dvh max-h-dvh w-full gap-0 overflow-hidden bg-background sm:max-w-[640px]"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0 space-y-2 border-b border-border bg-card p-5 pr-14 text-left sm:px-6 sm:pr-14">
          <p className="text-xs font-medium text-muted-foreground">Fiche chantier</p>
          <SheetTitle className="break-words text-xl font-semibold leading-tight">
            {signe && projet.client_nom ? projet.client_nom : 'Client confidentiel'}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{metiers.join(', ')}</span>
            <StatutArtisan statut={projet.statut} />
            {montant != null && (
              <span className="montant font-semibold text-foreground">
                {formatEuros(montant)}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
          <CorpsChantier
            projet={projet}
            signe={signe}
            adresse={adresse}
            onChange={onChange}
            onCreerDevis={onCreerDevis}
            onMesurer={onMesurer}
            encadre={false}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
