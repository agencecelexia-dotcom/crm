import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

// En-tête de page : titre + flèche retour optionnelle + action à droite.
export function PageHeader({
  titre,
  sousTitre,
  back,
  action,
}: {
  titre: string
  sousTitre?: string
  back?: boolean
  action?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="mb-4 flex items-start gap-2">
      {back && (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 mt-0.5 shrink-0"
          onClick={() => navigate(-1)}
          aria-label="Retour"
        >
          <ChevronLeft className="size-5" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold">{titre}</h1>
        {sousTitre && (
          <p className="truncate text-sm text-muted-foreground">{sousTitre}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
