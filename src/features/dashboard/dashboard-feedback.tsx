import { AlertCircle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Une source indisponible ne doit jamais se lire comme un résultat à zéro. */
export function DashboardFeedback({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <AlertCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        <RefreshCw className="size-4" aria-hidden />
        Réessayer
      </Button>
    </div>
  )
}
