import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatutBadge } from '@/components/statut-badge'
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
}: {
  projet: ProjetEspace | null
  signe: boolean
  onClose: () => void
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
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
        className="w-full overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="font-display text-xl tracking-tight">
            {signe && projet.client_nom ? projet.client_nom : 'Client confidentiel'}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{metiers.join(', ')}</span>
            <StatutBadge statut={projet.statut} />
            {montant != null && (
              <span className="montant font-semibold text-foreground">
                {formatEuros(montant)}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="px-4 pb-6">
          <CorpsChantier
            projet={projet}
            signe={signe}
            adresse={adresse}
            onChange={onChange}
            onCreerDevis={onCreerDevis}
            encadre={false}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
