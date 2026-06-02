import { useRef, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { communesParCodePostal, communesParNom } from '@/lib/communes'

// Champs Code postal + Ville avec autocomplétion croisée (geo.api.gouv.fr) :
//  - saisir un CP (5 chiffres) → remplit la ville (ou propose si plusieurs) ;
//  - saisir une ville → propose les communes + leur code postal.
export function CpVilleFields({
  codePostal,
  ville,
  onChange,
}: {
  codePostal: string
  ville: string
  onChange: (codePostal: string, ville: string) => void
}) {
  const [suggestions, setSuggestions] = useState<{ nom: string; cp: string }[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function debounce(fn: () => void) {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, 350)
  }

  function onCp(v: string) {
    onChange(v, ville)
    if (/^\d{5}$/.test(v)) {
      debounce(async () => {
        const communes = await communesParCodePostal(v)
        if (communes.length === 1) {
          onChange(v, communes[0].nom)
          setOpen(false)
          setSuggestions([])
        } else if (communes.length > 1) {
          setSuggestions(communes.map((c) => ({ nom: c.nom, cp: v })))
          setOpen(true)
        }
      })
    } else {
      setOpen(false)
    }
  }

  function onVille(v: string) {
    onChange(codePostal, v)
    debounce(async () => {
      const communes = await communesParNom(v)
      const list = communes
        .flatMap((c) =>
          (c.codesPostaux.length ? c.codesPostaux : ['']).slice(0, 3).map((cp) => ({
            nom: c.nom,
            cp,
          })),
        )
        .slice(0, 8)
      setSuggestions(list)
      setOpen(list.length > 0)
    })
  }

  function choisir(s: { nom: string; cp: string }) {
    onChange(s.cp || codePostal, s.nom)
    setOpen(false)
    setSuggestions([])
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cp">Code postal</Label>
          <Input
            id="cp"
            inputMode="numeric"
            maxLength={5}
            className="h-11"
            value={codePostal}
            onChange={(e) => onCp(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ville">Ville</Label>
          <Input
            id="ville"
            className="h-11"
            value={ville}
            onChange={(e) => onVille(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
          />
        </div>
      </div>

      {/* Suggestions (communes + code postal) */}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {suggestions.map((s, i) => (
            <li key={`${s.nom}-${s.cp}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // évite le blur avant le clic
                onClick={() => choisir(s)}
                className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{s.nom}</span>
                {s.cp && <span className="ml-2 shrink-0 text-muted-foreground">{s.cp}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
