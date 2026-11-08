import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/use-auth'
import { useDroits } from '@/lib/auth/use-droits'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { NavigationLinks } from './navigation-links'
import { navigationActive, navigationPourRole } from './navigation'

export function BottomNav() {
  const { estFondateur } = useAuth()
  const { peutCreerLead } = useDroits()
  const { pathname } = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const favoris = estFondateur
    ? ['/', '/taches', '/projets', '/artisans']
    : ['/', '/projets/a-reattribuer', '/projets', '/mon-pipe']
  const navigation = navigationPourRole(estFondateur, peutCreerLead).flatMap((groupe) => groupe.items)
  const items = favoris.flatMap((to) => navigation.filter((item) => item.to === to))
  const dansMenu = !items.some((item) => navigationActive(item, pathname))

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navigation principale"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {items.map((item) => {
          const actif = navigationActive(item, pathname)
          const Icon = item.icon
          return (
            <li key={item.to} className="min-w-0 flex-1">
              <Link
                to={item.to}
                aria-current={actif ? 'page' : undefined}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring',
                  actif ? 'bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
                <span>{item.to === '/' ? 'Accueil' : item.label}</span>
              </Link>
            </li>
          )
        })}
        <li className="min-w-0 flex-1">
          <Sheet open={ouvert} onOpenChange={setOuvert}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Ouvrir toute la navigation"
                className={cn(
                  'flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring',
                  dansMenu ? 'bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Menu className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
                <span>Menu</span>
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(320px,calc(100%-2rem))] gap-0 bg-card">
              <SheetHeader className="shrink-0 border-b border-border px-6 py-5">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>{estFondateur ? 'Espace fondateur' : 'Espace commercial'}</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <NavigationLinks estFondateur={estFondateur} peutCreerLead={peutCreerLead} onNavigate={() => setOuvert(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  )
}
