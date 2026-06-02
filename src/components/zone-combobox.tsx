import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ZONES_INTERVENTION } from '@/lib/constants'

// Sélecteur de zone d'intervention avec RECHERCHE + liste scrollable.
// Contient France entière + régions + départements (tape "Haute-Savoie" ou "74").
export function ZoneCombobox({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'h-11 w-full justify-between font-normal',
            !value && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{value || 'Choisir une zone'}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Rechercher (région, département, n°)…" />
          {/* CommandList scrollable → toutes les zones accessibles */}
          <CommandList>
            <CommandEmpty>Aucune zone trouvée.</CommandEmpty>
            <CommandGroup>
              {ZONES_INTERVENTION.map((z) => (
                <CommandItem
                  key={z}
                  value={z}
                  onSelect={() => {
                    onChange(z === value ? '' : z)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value === z ? 'opacity-100' : 'opacity-0')} />
                  {z}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
