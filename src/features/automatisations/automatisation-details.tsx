import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Même aide au survol, au clavier et au toucher. Le panneau reste survolable. */
export function AutomatisationDetails({ titre, children }: { titre: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retenir = () => clearTimeout(timer.current)
  const fermer = () => { retenir(); timer.current = setTimeout(() => setOpen(false), 200) }
  useEffect(() => () => clearTimeout(timer.current), [])
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`Détails : ${titre}`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { retenir(); setOpen(true) } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') fermer() }}
        onFocus={() => { retenir(); setOpen(true) }}
        onBlur={fermer}
        onClick={(e) => { e.preventDefault(); retenir(); setOpen(true) }}>
        <Info className="size-4" aria-hidden />
      </button>
    </PopoverTrigger>
    <PopoverContent className="max-h-[min(30rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] space-y-2 overflow-y-auto text-sm leading-relaxed" align="end"
      aria-label={`Fonctionnement : ${titre}`} onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()} onPointerEnter={retenir} onPointerLeave={fermer}
      onFocus={retenir} onBlur={fermer}>
      <p className="font-semibold">{titre}</p>
      {children}
    </PopoverContent>
  </Popover>
}
