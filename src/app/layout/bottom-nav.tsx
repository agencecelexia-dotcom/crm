import { NavLink } from 'react-router-dom'
import { Home, Map, FolderKanban, Users, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'

// Barre de navigation fixe en bas (mobile-first). Cibles de tap ≥ 48px.
const ITEMS = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  { to: '/taches', label: 'À faire', icon: ListChecks, end: false },
  { to: '/projets', label: 'Projets', icon: FolderKanban, end: false },
  { to: '/artisans', label: 'Artisans', icon: Users, end: false },
  { to: '/carte', label: 'Carte', icon: Map, end: false },
]

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navigation principale"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('size-5', isActive && 'stroke-[2.5]')} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
