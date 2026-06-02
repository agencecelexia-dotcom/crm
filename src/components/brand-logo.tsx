import { cn } from '@/lib/utils'

// Logo Celexia (image horizontale fournie dans public/logo.png).
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Celexia"
      className={cn('h-8 w-auto select-none', className)}
      draggable={false}
    />
  )
}
