import { useState } from 'react'
import { ChevronRight, Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { ECRANS, type VueEspace } from './ecrans-espace'

export function MenuEspace({
  vue,
  onAller,
  compteurs,
}: {
  vue: VueEspace
  onAller: (v: VueEspace) => void
  compteurs?: Partial<Record<VueEspace, number>>
}) {
  const [ouvert, setOuvert] = useState(false)
  const courant = ECRANS.find((e) => e.cle === vue) ?? ECRANS[0]

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 bg-card"
        aria-label="Ouvrir le menu"
        onClick={() => setOuvert(true)}
      >
        <Menu className="size-4" />
        <span className="hidden sm:inline">{courant.titre}</span>
      </Button>

      <Sheet open={ouvert} onOpenChange={setOuvert}>
        <SheetContent side="right" className="flex max-h-dvh w-[86vw] max-w-sm flex-col">
          <SheetHeader>
            <SheetTitle>Votre espace</SheetTitle>
            <SheetDescription className="sr-only">
              Choisissez l’écran à afficher.
            </SheetDescription>
          </SheetHeader>

          <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 pb-4">
            {ECRANS.map(({ cle, titre, detail, Icone }) => {
              const actif = cle === vue
              const n = compteurs?.[cle]
              return (
                <button
                  key={cle}
                  type="button"
                  aria-current={actif ? 'page' : undefined}
                  onClick={() => {
                    onAller(cle)
                    setOuvert(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                    actif
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-lg',
                      actif ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/70',
                    )}
                  >
                    <Icone className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', actif && 'font-semibold')}>
                      {titre}
                      {n != null && n > 0 && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
                          {n}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              )
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
