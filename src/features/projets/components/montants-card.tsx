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

// Carte "Argent" : montants devis + commission auto (10 %) + encaissement.
export function MontantsCard({ projet }: { projet: ProjetAvecArtisan }) {
  const patch = usePatchProjet()
  const [devis, setDevis] = useState(projet.montant_devis?.toString() ?? '')
  const [devisSigne, setDevisSigne] = useState(
    projet.montant_devis_signe?.toString() ?? '',
  )
  const [dateSign, setDateSign] = useState<Date | undefined>(
    projet.date_signature ? parseISO(projet.date_signature) : undefined,
  )
  const [taux, setTaux] = useState(
    String(Math.round((projet.taux_commission ?? 0.1) * 100)),
  )
  const [estim, setEstim] = useState(projet.estimation_interne?.toString() ?? '')

  function toNum(v: string): number | null {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  function enregistrer() {
    patch.mutate(
      {
        id: projet.id,
        patch: {
          montant_devis: toNum(devis),
          montant_devis_signe: toNum(devisSigne),
          estimation_interne: toNum(estim),
          date_signature: dateSign ? format(dateSign, 'yyyy-MM-dd') : null,
          taux_commission: (() => {
            const t = parseFloat(taux.replace(',', '.'))
            return Number.isFinite(t) && t >= 0 ? t / 100 : 0.1
          })(),
        },
      },
      {
        onSuccess: () => toast.success('Montants enregistrés'),
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
              value={devis}
              onChange={(e) => setDevis(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="montant_devis_signe">Devis signé TTC (€)</Label>
            <Input
              id="montant_devis_signe"
              type="number"
              inputMode="decimal"
              className="h-11"
              value={devisSigne}
              onChange={(e) => setDevisSigne(e.target.value)}
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
                onSelect={setDateSign}
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
            value={taux}
            onChange={(e) => setTaux(e.target.value)}
          />
        </div>

        <div className="space-y-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <Label htmlFor="estim" className="text-sm">
            🔒 Estimation interne (€){' '}
            <span className="text-xs font-normal text-muted-foreground">— potentiel, jamais visible par l'artisan</span>
          </Label>
          <Input
            id="estim"
            type="number"
            inputMode="decimal"
            className="h-11"
            value={estim}
            onChange={(e) => setEstim(e.target.value)}
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
          <span className="text-sm font-medium">Commission ({taux} % TTC)</span>
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
