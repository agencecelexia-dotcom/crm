import type { ReactNode } from 'react'

import { CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Titre compact de carte, sans accent décoratif concurrent du contenu.
// À utiliser dans un <CardHeader> à la place de <CardTitle className="text-base">.
export function CardTitre({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CardTitle
      className={cn('flex items-center gap-2 font-sans text-sm font-medium leading-5', className)}
    >
      {children}
    </CardTitle>
  )
}
