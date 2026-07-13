import { NavLink } from 'react-router-dom'
import { Home, Map, FolderKanban, Users, StickyNote, PenTool, Zap, LogOut, BadgeEuro, ListChecks, Target, type LucideIcon } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { NotificationsBell } from '@/features/automatisations/notifications-bell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/use-auth'

// Navigation latérale — affichée uniquement sur écrans larges (md+).
// Liens regroupés par usage pour une lecture rapide.
type Item = { to: string; label: string; icon: LucideIcon; end: boolean }

const GROUPES: { titre: string; items: Item[] }[] = [
  {
    titre: 'Pilotage',
    items: [
      { to: '/', label: 'Accueil', icon: Home, end: true },
      { to: '/taches', label: 'À faire', icon: ListChecks, end: false },
      { to: '/commissions', label: 'Commissions', icon: BadgeEuro, end: false },
    ],
  },
  {
    titre: 'Activité',
    items: [
      { to: '/projets', label: 'Projets', icon: FolderKanban, end: false },
      { to: '/artisans', label: 'Artisans', icon: Users, end: false },
      { to: '/carte', label: 'Carte', icon: Map, end: false },
      { to: '/couverture', label: 'Couverture', icon: Target, end: false },
    ],
  },
  {
    titre: 'Outils',
    items: [
      { to: '/notes', label: 'Notes', icon: StickyNote, end: false },
      { to: '/parametres/automatisations', label: 'Automatisations', icon: Zap, end: false },
      { to: '/parametres/signature', label: 'Ma signature', icon: PenTool, end: false },
    ],
  },
]

export function Sidebar() {
  const { session, signOut } = useAuth()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border/70 bg-card md:flex">
      <div className="flex h-16 items-center justify-between border-b border-border/70 px-5">
        <BrandLogo className="h-7" />
        <NotificationsBell />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {GROUPES.map((groupe) => (
          <div key={groupe.titre}>
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {groupe.titre}
            </p>
            <div className="space-y-0.5">
              {groupe.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/8 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary"
                        />
                      )}
                      <Icon className="size-5" />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border/70 p-3">
        <p className="mb-2 truncate rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {session?.user.email}
        </p>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground transition-colors hover:text-[#DC2626]"
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" />
          Se déconnecter
        </Button>
      </div>
    </aside>
  )
}
