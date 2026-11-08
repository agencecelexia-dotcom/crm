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
    <div className="mb-7 flex flex-wrap items-start gap-x-4 gap-y-4">
      {back && (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 mt-0.5 shrink-0 rounded-xl active:scale-[0.98]"
          onClick={() => navigate(-1)}
          aria-label="Retour"
        >
          <ChevronLeft className="size-5" />
        </Button>
      )}
      <div className="min-w-0 flex-1 basis-48">
        <h1 className="break-words font-display text-[28px] font-medium leading-tight tracking-[-0.02em] sm:text-[32px]">{titre}</h1>
        {sousTitre && (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{sousTitre}</p>
        )}
      </div>
      {action && <div className="w-full min-w-0 [&>div]:flex-wrap sm:ml-auto sm:w-auto">{action}</div>}
    </div>
  )
}
