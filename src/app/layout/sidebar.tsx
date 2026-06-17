import { NavLink } from 'react-router-dom'
import { Home, Map, FolderKanban, Users, StickyNote, PenTool, Zap, LogOut, BadgeEuro } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { NotificationsBell } from '@/features/automatisations/notifications-bell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/use-auth'

// Navigation latérale — affichée uniquement sur écrans larges (md+).
const ITEMS = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  { to: '/carte', label: 'Carte', icon: Map, end: false },
  { to: '/projets', label: 'Projets', icon: FolderKanban, end: false },
  { to: '/commissions', label: 'Commissions', icon: BadgeEuro, end: false },
  { to: '/artisans', label: 'Artisans', icon: Users, end: false },
  { to: '/notes', label: 'Notes', icon: StickyNote, end: false },
  { to: '/parametres/automatisations', label: 'Automatisations', icon: Zap, end: false },
  { to: '/parametres/signature', label: 'Ma signature', icon: PenTool, end: false },
]

export function Sidebar() {
  const { session, signOut } = useAuth()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-16 items-center justify-between border-b border-border px-5">
        <BrandLogo className="h-7" />
        <NotificationsBell />
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-primary'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <p className="truncate px-2 pb-2 text-xs text-muted-foreground">
          {session?.user.email}
        </p>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" />
          Se déconnecter
        </Button>
      </div>
    </aside>
  )
}
