import type { ReactNode } from 'react'

import { CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Titre de carte commun : petit tiret violet + Clash Display.
// À utiliser dans un <CardHeader> à la place de <CardTitle className="text-base">.
export function CardTitre({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CardTitle
      className={cn('flex items-center gap-2 font-display text-base tracking-tight', className)}
    >
      <span aria-hidden className="inline-block h-4 w-1 shrink-0 rounded-full bg-primary" />
      {children}
    </CardTitle>
  )
}
