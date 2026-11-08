import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'brand'

/** Une valeur, son périmètre et son libellé ; le contenu porte la hiérarchie. */
export function StatTile({
  label,
  valeur,
  sousLabel,
  tone = 'default',
  grouped = false,
}: {
  icon: LucideIcon
  label: string
  valeur: string
  sousLabel?: string
  tone?: Tone
  grouped?: boolean
}) {
  return (
    <div className={cn(
      'min-w-0 bg-card px-4 py-5 sm:px-5',
      grouped
        ? 'even:border-l even:border-border [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-border lg:[&:nth-child(n+2)]:border-l lg:[&:nth-child(n+2)]:border-border lg:[&:nth-child(n+3)]:border-t-0'
        : 'rounded-xl border border-border',
    )}>
      <p className="text-xs text-muted-foreground sm:text-[13px]">{label}</p>
      <p className={cn('montant mt-3 break-words text-2xl font-medium leading-none sm:text-[32px]', tone === 'brand' && 'text-primary', tone === 'danger' && 'text-destructive')}>{valeur}</p>
      {sousLabel && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{sousLabel}</p>}
    </div>
  )
}

// Barre partagée à deux segments proportionnels, sans animation des dimensions.
export function SplitBar({
  gauche,
  droite,
  couleurGauche,
  couleurDroite,
}: {
  gauche: number
  droite: number
  couleurGauche: string
  couleurDroite: string
}) {
  const total = gauche + droite
  const pct = total > 0 ? Math.max(0, Math.min(100, (gauche / total) * 100)) : 0
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-muted" aria-hidden>
      {total > 0 && <><div className="h-full" style={{ width: `${pct}%`, background: couleurGauche }} /><div className="h-full flex-1" style={{ background: droite > 0 ? couleurDroite : 'transparent' }} /></>}
    </div>
  )
}
