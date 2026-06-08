import { useState } from 'react'
import { FileSignature, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Artisan } from '@/types/database'
import {
  CONTRAT_MODELE,
  VARIABLES_CONTRAT,
  variablesParDefaut,
  remplirContrat,
} from './contrat-modele'
import { useGenererContrat } from './use-contrats'
import { CLE_SIGNATURE_APPORTEUR, useParametre } from '@/features/parametres/use-parametres'

// Dialog "Préparer le contrat" : variables pré-remplies depuis la fiche artisan,
// éditables, puis génération du contrat (contenu figé) prêt à signer.
export function ContratGenerateur({ artisan }: { artisan: Artisan }) {
  const [open, setOpen] = useState(false)
  const [vars, setVars] = useState<Record<string, string>>(() =>
    variablesParDefaut(artisan),
  )
  const generer = useGenererContrat()
  const { data: signatureApporteur } = useParametre(CLE_SIGNATURE_APPORTEUR)

  function lancer() {
    const contenu = remplirContrat(CONTRAT_MODELE, vars)
    generer.mutate(
      { artisanId: artisan.id, contenu, apporteurSignature: signatureApporteur },
      {
        onSuccess: () => {
          toast.success('Contrat généré')
          setOpen(false)
        },
        onError: (e) =>
          toast.error('Génération impossible', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setVars(variablesParDefaut(artisan)) // recharge les valeurs à l'ouverture
      }}
    >
      <DialogTrigger asChild>
        <Button className="w-full">
          <FileSignature className="size-4" />
          Préparer le contrat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Préparer le contrat</DialogTitle>
          <DialogDescription>
            Vérifie les variables (pré-remplies depuis la fiche). Modifiables avant génération.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          {VARIABLES_CONTRAT.map(({ cle, label }) => (
            <div key={cle} className="space-y-1.5">
              <Label htmlFor={cle} className="text-xs">
                {label}
              </Label>
              <Input
                id={cle}
                className="h-10"
                value={vars[cle] ?? ''}
                onChange={(e) => setVars((v) => ({ ...v, [cle]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        {(() => {
          const cles = ['SOCIETE_ARTISAN', 'SIREN_ARTISAN', 'REPRESENTANT_ARTISAN']
          const manquantes = cles.filter((c) => !(vars[c] ?? '').trim())
          if (manquantes.length === 0) return null
          return (
            <p className="rounded-md border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-2 text-xs text-[#92400E]">
              ⚠️ Infos société incomplètes (société, SIREN ou représentant). Le contrat sera généré
              avec des champs vides — complète-les ci-dessus ou via la recherche SIRET sur la fiche
              artisan.
            </p>
          )
        })()}

        <DialogFooter>
          <Button onClick={lancer} disabled={generer.isPending} className="w-full">
            {generer.isPending && <Loader2 className="size-4 animate-spin" />}
            Générer le contrat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
