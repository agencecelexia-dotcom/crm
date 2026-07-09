import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'brand'

const TONES: Record<Tone, { carte: string; valeur: string; icone: string; label: string }> = {
  default: { carte: '', valeur: '', icone: 'text-muted-foreground', label: 'text-muted-foreground' },
  success: {
    carte: 'border-[#22C55E]/25 bg-[#22C55E]/5',
    valeur: 'text-[#16A34A]',
    icone: 'text-[#16A34A]',
    label: 'text-muted-foreground',
  },
  warning: {
    carte: 'border-[#F59E0B]/25 bg-[#F59E0B]/5',
    valeur: 'text-[#B45309]',
    icone: 'text-[#B45309]',
    label: 'text-muted-foreground',
  },
  danger: {
    carte: 'border-[#EF4444]/25 bg-[#EF4444]/5',
    valeur: 'text-[#DC2626]',
    icone: 'text-[#DC2626]',
    label: 'text-muted-foreground',
  },
  brand: {
    carte: 'border-transparent bg-primary text-primary-foreground',
    valeur: '',
    icone: '',
    label: 'opacity-80',
  },
}

// Tuile KPI générique : chiffre + icône + libellé, avec une teinte sémantique
// (succès / attente / perdu / marque) partagée par tous les indicateurs du dashboard.
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
    <Card className={cn(t.carte)}>
      <CardContent className="px-4 py-4">
        <div className={cn('mb-1 flex items-center gap-1.5 text-xs', t.label)}>
          <Icon className={cn('size-4 shrink-0', t.icone)} />
          <span className="truncate">{label}</span>
        </div>
        <p className={cn('montant text-2xl font-semibold', t.valeur)}>{valeur}</p>
        {sousLabel && (
          <p className={cn('mt-0.5 truncate text-xs', tone === 'brand' ? 'opacity-70' : 'text-muted-foreground')}>
            {sousLabel}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
