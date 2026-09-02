import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CHAMPS_PILOTES } from './donnees'
import type { ChampSchema } from './use-creatives'

/**
 * Construit le formulaire depuis le schéma OpenAPI du modèle.
 *
 * C'est ce qui rend l'écran utilisable avec n'importe lequel des 1 491 modèles
 * de fal : chacun a ses propres paramètres, et les coder à la main aurait
 * limité l'outil à une poignée d'entre eux.
 *
 * Les champs que l'écran gère déjà (prompt, format, nombre d'images) sont
 * écartés — les redemander ici créerait deux endroits pour la même valeur.
 */
export function FormulaireDynamique({
  champs,
  valeurs,
  onChange,
}: {
  champs: ChampSchema[]
  valeurs: Record<string, unknown>
  onChange: (nom: string, valeur: unknown) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const avances = champs.filter((c) => !CHAMPS_PILOTES.includes(c.nom))

  if (avances.length === 0) return null

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium"
      >
        <span>
          Réglages avancés
          <span className="ml-1.5 font-normal text-muted-foreground">
            {avances.length} paramètres
          </span>
        </span>
        <ChevronDown className={cn('size-4 transition-transform', ouvert && 'rotate-180')} />
      </button>

      {ouvert && (
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
          {avances.map((c) => (
            <Champ
              key={c.nom}
              champ={c}
              valeur={valeurs[c.nom]}
              onChange={(v) => onChange(c.nom, v)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Champ({
  champ,
  valeur,
  onChange,
}: {
  champ: ChampSchema
  valeur: unknown
  onChange: (v: unknown) => void
}) {
  const libelle = champ.titre ?? champ.nom
  const courante = valeur ?? champ.defaut

  // Un enum devient une liste : taper la valeur à la main inviterait la faute
  // de frappe, que fal refuserait sans expliquer laquelle.
  if (champ.options?.length) {
    return (
      <Cadre champ={champ} libelle={libelle}>
        <Select value={String(courante ?? '')} onValueChange={onChange}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {champ.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Cadre>
    )
  }

  if (champ.type === 'boolean') {
    return (
      <Cadre champ={champ} libelle={libelle}>
        <div className="flex h-10 items-center">
          <Switch checked={Boolean(courante)} onCheckedChange={onChange} />
        </div>
      </Cadre>
    )
  }

  if (champ.type === 'integer' || champ.type === 'number') {
    return (
      <Cadre champ={champ} libelle={libelle}>
        <Input
          type="number"
          className="h-10"
          min={champ.min}
          max={champ.max}
          value={courante === undefined || courante === null ? '' : String(courante)}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
        />
      </Cadre>
    )
  }

  return (
    <Cadre champ={champ} libelle={libelle}>
      <Input
        className="h-10"
        value={courante === undefined || courante === null ? '' : String(courante)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </Cadre>
  )
}

function Cadre({
  champ,
  libelle,
  children,
}: {
  champ: ChampSchema
  libelle: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label className="text-xs">
        {libelle}
        {champ.requis && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
      {champ.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{champ.description}</p>
      )}
    </div>
  )
}
