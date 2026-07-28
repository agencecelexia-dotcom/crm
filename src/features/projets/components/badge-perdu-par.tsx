import { UserMinus } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Signale qu'un ou plusieurs artisans ont déjà lâché ce dossier.
 * Évite de confondre un lead jamais travaillé avec un lead refusé 2 fois.
 */
export function BadgePerduPar({ nb, className }: { nb: number; className?: string }) {
  if (nb <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-[#F59E0B]/25 bg-[#F59E0B]/10 px-2 py-0.5 text-[11px] font-medium text-[#B45309]',
        className,
      )}
      title={`${nb} artisan${nb > 1 ? 's ont' : ' a'} déclaré ce chantier perdu`}
    >
      <UserMinus className="size-3" />
      Perdu par {nb} artisan{nb > 1 ? 's' : ''}
    </span>
  )
}
