import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'brand'
const TONES: Record<Tone, string> = {
  default: 'text-foreground',
  success: 'text-emerald-700',
  warning: 'text-amber-800',
  danger: 'text-red-700',
  brand: 'text-primary',
}

// La valeur mène la lecture. La couleur n'habille plus toute la carte.
export function KpiTile({ label, valeur, sousLabel, tone = 'default' }: {
  icon: LucideIcon
  label: string
  valeur: string
  sousLabel?: string
  tone?: Tone
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('montant mt-3 break-words text-2xl font-medium sm:text-3xl', TONES[tone])}>
        {valeur}
      </p>
      {sousLabel && <p className="mt-2 text-xs leading-5 text-muted-foreground">{sousLabel}</p>}
    </div>
  )
}
