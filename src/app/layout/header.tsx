import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, LogOut, PenTool } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/auth/use-auth'
import { useDroits } from '@/lib/auth/use-droits'
import { NotificationsBell } from '@/features/automatisations/notifications-bell'
import { navigationActive, navigationPourRole } from './navigation'

export function Header() {
  const { session, signOut, estFondateur } = useAuth()
  const { peutCreerLead } = useDroits()
  const { pathname } = useLocation()
  const email = session?.user.email ?? ''
  const groupe = navigationPourRole(estFondateur, peutCreerLead).find((g) => g.items.some((item) => navigationActive(item, pathname)))
  const page = groupe?.items.find((item) => navigationActive(item, pathname))
  const sousPage = page && pathname !== page.to

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card md:ml-60">
      <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-8">
        <Link to="/" aria-label="Celexia — tableau de bord" className="rounded-md md:hidden">
          <BrandLogo className="h-6" />
        </Link>
        <nav aria-label="Fil d’Ariane" className="hidden min-w-0 items-center gap-2 text-xs md:flex">
          <span className="text-muted-foreground">{groupe?.titre ?? 'Espace de travail'}</span>
          <ChevronRight className="size-3 text-muted-foreground/60" aria-hidden />
          {sousPage ? <><Link to={page.to} className="text-muted-foreground hover:text-foreground">{page.label}</Link><ChevronRight className="size-3 text-muted-foreground/60" aria-hidden /><span className="font-medium">{pathname.endsWith('/new') ? 'Création' : pathname.endsWith('/edit') ? 'Modification' : 'Détail'}</span></> : <span className="font-medium text-foreground">{page?.label ?? 'Dossier'}</span>}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-muted-foreground lg:block">{estFondateur ? 'Vue agence' : 'Espace commercial'}</span>
          <NotificationsBell />
          <span aria-hidden className="h-5 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu du compte" className="size-8 rounded-full border border-border bg-muted text-xs font-semibold">
                {email.slice(0, 1).toUpperCase() || 'C'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link to="/parametres/signature"><PenTool className="size-4" aria-hidden />Ma signature</Link></DropdownMenuItem>
              <DropdownMenuItem onClick={() => void signOut()}><LogOut className="size-4" aria-hidden />Se déconnecter</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
