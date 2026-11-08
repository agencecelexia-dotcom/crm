import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Titre de section commun : Clash Display et compteur secondaire optionnel.
export function SectionTitre({
  children,
  compte,
  className,
}: {
  children: ReactNode
  compte?: number
  className?: string
}) {
  return (
    <h2
      className={cn(
        'mb-4 flex items-center gap-2 font-display text-xl font-medium',
        className,
      )}
    >
      <span>{children}</span>
      {compte != null && (
        <span className="font-sans text-base font-normal text-muted-foreground">({compte})</span>
      )}
    </h2>
  )
}
