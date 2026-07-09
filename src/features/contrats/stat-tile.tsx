import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'brand'

const TONES: Record<Tone, { carte: string; valeur: string; icone: string }> = {
  default: { carte: 'border-border/70 bg-card', valeur: '', icone: 'bg-muted text-muted-foreground' },
  success: {
    carte: 'border-[#22C55E]/25 bg-[#22C55E]/5',
    valeur: 'text-[#16A34A]',
    icone: 'bg-[#22C55E]/15 text-[#16A34A]',
  },
  warning: {
    carte: 'border-[#F59E0B]/25 bg-[#F59E0B]/5',
    valeur: 'text-[#B45309]',
    icone: 'bg-[#F59E0B]/15 text-[#B45309]',
  },
  danger: {
    carte: 'border-[#EF4444]/25 bg-[#EF4444]/5',
    valeur: 'text-[#DC2626]',
    icone: 'bg-[#EF4444]/15 text-[#DC2626]',
  },
  brand: {
    carte: 'border-primary/25 bg-primary/5',
    valeur: 'text-primary',
    icone: 'bg-primary/10 text-primary',
  },
}

// Tuile de stat compacte du portail artisan (padding serré, pensée mobile-first).
export function StatTile({
  icon: Icon,
  label,
  valeur,
  sousLabel,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  valeur: string
  sousLabel?: string
  tone?: Tone
}) {
  const t = TONES[tone]
  return (
    <div className={cn('rounded-2xl border p-3.5 shadow-card', t.carte)}>
      <span className={cn('mb-2 flex size-8 items-center justify-center rounded-lg', t.icone)}>
        <Icon className="size-4" />
      </span>
      <p className={cn('montant text-xl font-semibold sm:text-2xl', t.valeur)}>{valeur}</p>
      <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{label}</p>
      {sousLabel && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{sousLabel}</p>}
    </div>
  )
}

// Barre partagée à deux segments proportionnels (ex : commission à régler / réglée).
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
  const pct = total > 0 ? Math.round((gauche / total) * 100) : 0
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
      {total > 0 && (
        <>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${Math.max(pct, gauche > 0 ? 4 : 0)}%`, background: couleurGauche }}
          />
          <div
            className="h-full flex-1 transition-all duration-300"
            style={{ background: droite > 0 ? couleurDroite : 'transparent' }}
          />
        </>
      )}
    </div>
  )
}
