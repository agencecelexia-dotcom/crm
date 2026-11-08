import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { usePatchProjet } from '../hooks/use-projets'
import type { ProjetAvecArtisan } from '@/types/database'
import { champsMontants, patchMontants, type ChampsMontants } from '../lib/montants-form'

// Carte "Argent" : montants devis + commission auto (10 %) + encaissement.
export function MontantsCard({ projet }: { projet: ProjetAvecArtisan }) {
  const patch = usePatchProjet()
  const [modifications, setModifications] = useState<Partial<ChampsMontants>>({})
  // Les champs intacts suivent les données serveur, sans écraser la saisie.
  const champs = { ...champsMontants(projet), ...modifications }
  const dateSign = champs.date_signature ? parseISO(champs.date_signature) : undefined

  function modifier(champ: keyof ChampsMontants, valeur: string) {
    setModifications((courant) => ({ ...courant, [champ]: valeur }))
  }

  function enregistrer() {
    const modifie = patchMontants(projet, modifications)
    if (Object.keys(modifie).length === 0) {
      toast.info('Aucune modification à enregistrer')
      return
    }
    patch.mutate(
      {
        id: projet.id,
        patch: modifie,
      },
      {
        onSuccess: () => {
          setModifications({})
          toast.success('Montants enregistrés')
        },
        onError: (err) =>
          toast.error('Enregistrement impossible', {
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    )
  }

  // Bascule "commission encaissée" (mise à jour immédiate).
  function toggleEncaissee(value: boolean) {
    patch.mutate(
      { id: projet.id, patch: { commission_encaissee: value } },
      {
        onError: (err) =>
          toast.error('Mise à jour impossible', {
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    )
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader>
        <CardTitre>Argent</CardTitre>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="montant_devis">Montant devis TTC (€)</Label>
            <Input
              id="montant_devis"
              type="number"
              inputMode="decimal"
              className="h-11"
              value={champs.montant_devis}
              disabled={patch.isPending}
              onChange={(e) => modifier('montant_devis', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="montant_devis_signe">Devis signé TTC (€)</Label>
            <Input
              id="montant_devis_signe"
              type="number"
              inputMode="decimal"
              className="h-11"
              value={champs.montant_devis_signe}
              disabled={patch.isPending}
              onChange={(e) => modifier('montant_devis_signe', e.target.value)}
            />
          </div>
        </div>

        {/* Date de signature */}
        <div className="space-y-1.5">
          <Label>Date de signature</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={patch.isPending}
                className={cn(
                  'h-11 w-full justify-start font-normal',
                  !dateSign && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="size-4" />
                {dateSign
                  ? format(dateSign, 'd MMMM yyyy', { locale: fr })
                  : 'Choisir une date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateSign}
                onSelect={(date) => modifier('date_signature', date ? format(date, 'yyyy-MM-dd') : '')}
                disabled={patch.isPending}
                locale={fr}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="taux">Taux de commission (%)</Label>
          <Input
            id="taux"
            type="number"
            inputMode="decimal"
            className="h-11"
            value={champs.taux_commission}
            disabled={patch.isPending}
            onChange={(e) => modifier('taux_commission', e.target.value)}
          />
        </div>

        <div className="space-y-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <Label htmlFor="estim" className="text-sm">
            Estimation interne (€){' '}
            <span className="text-xs font-normal text-muted-foreground">— potentiel, jamais visible par l'artisan</span>
          </Label>
          <Input
            id="estim"
            type="number"
            inputMode="decimal"
            className="h-11"
            value={champs.estimation_interne}
            disabled={patch.isPending}
            onChange={(e) => modifier('estimation_interne', e.target.value)}
          />
        </div>

        <Button onClick={enregistrer} disabled={patch.isPending} className="h-11 w-full">
          {patch.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Enregistrer les montants
        </Button>

        <Separator />

        {/* Commission calculée par la base (10 %) — jamais recalculée côté front */}
        <div className="flex items-center justify-between rounded-lg bg-secondary p-3">
          <span className="text-sm font-medium">Commission ({champsMontants(projet).taux_commission} % TTC)</span>
          <span className="montant text-xl font-semibold text-primary">
            {formatEuros(projet.commission)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="encaissee" className="cursor-pointer">
            Commission encaissée
          </Label>
          <Switch
            id="encaissee"
            checked={projet.commission_encaissee}
            onCheckedChange={toggleEncaissee}
            disabled={patch.isPending}
          />
        </div>
      </CardContent>
    </Card>
  )
}
