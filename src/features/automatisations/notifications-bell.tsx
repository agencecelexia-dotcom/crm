import { Link } from 'react-router-dom'
import { Bell, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDateHeure } from '@/lib/format'
import { useNotifications, useMarquerLue, useToutMarquerLu } from './use-notifications'

// Cloche d'alertes in-app : escalades « à appeler » (artisan qui n'a pas signé / pas avancé).
export function NotificationsBell() {
  const { data: notifs } = useNotifications()
  const marquer = useMarquerLue()
  const toutLu = useToutMarquerLu()
  const nonLues = (notifs ?? []).filter((n) => !n.lu).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="size-5" />
          {nonLues > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-bold text-white">
              {nonLues}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Alertes</span>
          {nonLues > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toutLu.mutate()}>
              Tout marquer lu
            </Button>
          )}
        </div>
        <div className="max-h-[60dvh] overflow-y-auto">
          {!notifs || notifs.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucune alerte 🎉</p>
          ) : (
            notifs.map((n) => {
              const contenu = (
                <div className={n.lu ? 'opacity-60' : ''}>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {!n.lu && <span className="size-2 shrink-0 rounded-full bg-[#EF4444]" />}
                    {n.titre}
                  </p>
                  {n.message && <p className="text-xs text-muted-foreground">{n.message}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDateHeure(n.created_at)}
                  </p>
                </div>
              )
              return (
                <div key={n.id} className="flex items-start gap-2 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {n.projet_id ? (
                      <Link to={`/projets/${n.projet_id}`} onClick={() => !n.lu && marquer.mutate(n.id)}>
                        {contenu}
                      </Link>
                    ) : (
                      contenu
                    )}
                  </div>
                  {!n.lu && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label="Marquer lu"
                      onClick={() => marquer.mutate(n.id)}
                    >
                      <Check className="size-4" />
                    </Button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
