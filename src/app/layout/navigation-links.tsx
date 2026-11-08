import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { navigationActive, navigationPourRole } from './navigation'

export function NavigationLinks({ estFondateur, peutCreerLead, onNavigate, appearance = 'light' }: {
  estFondateur: boolean
  peutCreerLead: boolean
  onNavigate?: () => void
  appearance?: 'light' | 'dark'
}) {
  const { pathname } = useLocation()

  return (
    <div className="space-y-5">
      {navigationPourRole(estFondateur, peutCreerLead).map((groupe) => (
        <div key={groupe.titre}>
          <p className={cn('mb-2 px-3 text-[11px] font-medium', appearance === 'dark' ? 'text-[#a5a5af]' : 'text-muted-foreground')}>{groupe.titre}</p>
          <ul className="space-y-0.5">
            {groupe.items.map((item) => {
              const actif = navigationActive(item, pathname)
              const Icon = item.icon
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={actif ? 'page' : undefined}
                    className={cn(
                      'relative flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8 md:py-1.5',
                      appearance === 'dark'
                        ? actif ? 'bg-white/9 font-medium text-white ring-1 ring-inset ring-white/8' : 'text-[#b9b9c3] hover:bg-white/5 hover:text-white'
                        : actif ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', appearance === 'dark' && actif && 'text-[#b6a1f0]')} strokeWidth={1.5} aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
