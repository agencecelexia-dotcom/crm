import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'brand'

const TONES: Record<
  Tone,
  { carte: string; valeur: string; icone: string; label: string }
> = {
  default: {
    carte: 'border-border/70 bg-card',
    valeur: '',
    icone: 'bg-muted text-muted-foreground',
    label: 'text-muted-foreground',
  },
  success: {
    carte: 'border-[#22C55E]/25 bg-[#22C55E]/5',
    valeur: 'text-[#16A34A]',
    icone: 'bg-[#22C55E]/15 text-[#16A34A]',
    label: 'text-muted-foreground',
  },
  warning: {
    carte: 'border-[#F59E0B]/25 bg-[#F59E0B]/5',
    valeur: 'text-[#B45309]',
    icone: 'bg-[#F59E0B]/15 text-[#B45309]',
    label: 'text-muted-foreground',
  },
  danger: {
    carte: 'border-[#EF4444]/25 bg-[#EF4444]/5',
    valeur: 'text-[#DC2626]',
    icone: 'bg-[#EF4444]/15 text-[#DC2626]',
    label: 'text-muted-foreground',
  },
  brand: {
    carte: 'border-transparent bg-primary text-primary-foreground shadow-violet',
    valeur: '',
    icone: 'bg-white/15',
    label: 'opacity-80',
  },
}

// Tuile KPI générique : chiffre + icône + libellé, avec une teinte sémantique
// (succès / attente / perdu / marque) partagée par les indicateurs de l'admin.
export function KpiTile({
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
    <div className={cn('rounded-2xl border p-4 shadow-card', t.carte)}>
      <div className={cn('mb-2 flex items-center gap-2 text-xs', t.label)}>
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', t.icone)}>
          <Icon className="size-4" />
        </span>
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('montant text-xl font-semibold sm:text-2xl', t.valeur)}>{valeur}</p>
      {sousLabel && (
        <p
          className={cn(
            'mt-0.5 truncate text-xs',
            tone === 'brand' ? 'opacity-70' : 'text-muted-foreground',
          )}
        >
          {sousLabel}
        </p>
      )}
    </div>
  )
}
