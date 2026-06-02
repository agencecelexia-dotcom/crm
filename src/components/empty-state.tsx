import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// État vide réutilisable (liste sans résultat, etc.).
export function EmptyState({
  icon: Icon,
  titre,
  description,
  action,
}: {
  icon: LucideIcon
  titre: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <Icon className="mb-3 size-8 text-muted-foreground" />
      <p className="font-medium">{titre}</p>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
