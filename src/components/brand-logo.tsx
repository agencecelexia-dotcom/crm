import { cn } from '@/lib/utils'
import { useId } from 'react'

// Logo Celexia (image horizontale fournie dans public/logo.png).
export function BrandLogo({ className, sombre = false }: { className?: string; sombre?: boolean }) {
  const filtre = useId().replace(/:/g, '')
  // Sur fond sombre : conserver le symbole violet, éclaircir le mot et
  // rendre le fond blanc transparent. Le dessin original reste inchangé.
  if (sombre) return (
    <svg viewBox="0 0 605 98" width="605" height="98" role="img" aria-label="Celexia" className={cn('h-8 w-auto select-none', className)}>
      <defs>
        <filter id={filtre} colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" result="mot" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 -1 0 1" />
          <feColorMatrix in="SourceGraphic" result="symbole" type="matrix" values="0 0 0 0 .55  0 0 0 0 .31  0 0 0 0 1  0 -1.45 1.45 0 0" />
          <feMerge><feMergeNode in="mot" /><feMergeNode in="symbole" /></feMerge>
        </filter>
      </defs>
      <image href="/logo.png" width="605" height="98" filter={`url(#${filtre})`} />
    </svg>
  )
  return (
    <img
      src="/logo.png"
      alt="Celexia"
      className={cn('h-8 w-auto select-none', className)}
      draggable={false}
    />
  )
}
