import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Titre de section commun : tiret violet + Clash Display + compteur optionnel.
// Même recette visuelle que l'espace artisan, partagée par toutes les pages admin.
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
        'mb-4 flex items-center gap-2.5 font-display text-xl tracking-tight sm:text-2xl',
        className,
      )}
    >
      <span aria-hidden className="inline-block h-5 w-1 rounded-full bg-primary" />
      <span>{children}</span>
      {compte != null && (
        <span className="font-sans text-base font-normal text-muted-foreground">({compte})</span>
      )}
    </h2>
  )
}
