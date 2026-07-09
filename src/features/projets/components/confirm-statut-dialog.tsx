import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { STATUTS } from '@/lib/constants'
import type { StatutProjet } from '@/types/database'

// Double confirmation avant tout changement de statut (aucune logique métier ici :
// le composant appelant reste seul responsable de la mutation réelle).
export function ConfirmStatutDialog({
  open,
  statut,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  statut: StatutProjet | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Changer le statut ?</AlertDialogTitle>
          <AlertDialogDescription>
            {statut
              ? `Passer ce projet en « ${STATUTS[statut].label} » ? Êtes-vous sûr ?`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirmer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
