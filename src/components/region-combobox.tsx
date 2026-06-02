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
import { REGIONS } from '@/lib/constants'

// Sélecteur de région avec RECHERCHE + liste déroulante scrollable.
// Tape "H" → les régions correspondantes (Hauts-de-France…) se filtrent.
export function RegionCombobox({
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
          {value || 'Choisir une région'}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Rechercher une région…" />
          {/* CommandList est scrollable (max-h + overflow) → toutes les régions accessibles */}
          <CommandList>
            <CommandEmpty>Aucune région trouvée.</CommandEmpty>
            <CommandGroup>
              {REGIONS.map((r) => (
                <CommandItem
                  key={r}
                  value={r}
                  onSelect={() => {
                    onChange(r === value ? '' : r)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value === r ? 'opacity-100' : 'opacity-0')} />
                  {r}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
