import { useState } from 'react'
import { ChevronRight, Menu } from 'lucide-react'

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { ECRANS, type VueEspace } from './ecrans-espace'

export function MenuEspace({ vue, onAller, compteurs }: {
  vue: VueEspace
  onAller: (v: VueEspace) => void
  compteurs?: Partial<Record<VueEspace, number>>
}) {
  const [ouvert, setOuvert] = useState(false)
  const actifMenu = !['chantiers', 'devis', 'entreprise'].includes(vue)
  return (
    <>
      <button type="button" aria-label="Ouvrir le menu" onClick={() => setOuvert(true)} className={cn('flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors', actifMenu ? 'bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted')}><Menu className="size-[18px]" strokeWidth={1.5} aria-hidden /><span>Menu</span></button>
      <Sheet open={ouvert} onOpenChange={setOuvert}>
        <SheetContent side="right" className="flex w-[min(360px,calc(100%-1rem))] flex-col gap-0">
          <SheetHeader className="border-b border-border px-6 py-6"><SheetTitle>Votre espace artisan</SheetTitle><SheetDescription>Chantiers, documents et relation avec l’agence</SheetDescription></SheetHeader>
          <nav aria-label="Toutes les rubriques artisan" className="min-h-0 flex-1 overflow-y-auto p-3">
            {ECRANS.map(({ cle, titre, detail, Icone }) => <button key={cle} type="button" aria-current={cle === vue ? 'page' : undefined} onClick={() => { onAller(cle); setOuvert(false) }} className={cn('my-1 flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors', cle === vue ? 'bg-muted text-foreground' : 'hover:bg-muted/60')}>
              <Icone className={cn('size-4 shrink-0', cle === vue ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{titre}{compteurs?.[cle] != null && <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">{compteurs[cle]}</span>}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{detail}</span></span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>)}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
