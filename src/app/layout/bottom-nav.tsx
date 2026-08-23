import { NavLink } from 'react-router-dom'
import { Home, FolderKanban, Users, ListChecks, RotateCcw, Map } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/use-auth'

// Barre de navigation fixe en bas (mobile-first). Cibles de tap ≥ 48px.
//
// Cinq entrées maximum : au-delà, les cibles deviennent trop étroites au pouce.
// « À réattribuer » remplace « Carte » pour un commercial — c'est son écran de
// travail et sa seule source de commission, alors que la carte relève du
// pilotage. La carte reste accessible depuis la barre latérale sur écran large.
const ITEMS = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  // « À faire » suit le pipe artisan : c'est du pilotage, pas le travail du
  // commercial. Il ne le voit donc pas.
  { to: '/taches', label: 'À faire', icon: ListChecks, end: false, fondateurSeul: true },
  { to: '/projets', label: 'Pipe', icon: FolderKanban, end: true },
  { to: '/projets/a-reattribuer', label: 'À reprendre', icon: RotateCcw, end: false, commercialSeul: true },
  { to: '/artisans', label: 'Artisans', icon: Users, end: false },
  { to: '/carte', label: 'Carte', icon: Map, end: false, fondateurSeul: true },
]

export function BottomNav() {
  const { estFondateur } = useAuth()
  // Un fondateur pilote : la carte lui sert plus que la pile de reprise, qu'il
  // suit depuis l'écran Reprises.
  const items = ITEMS.filter((i) =>
    estFondateur ? !i.commercialSeul : !i.fondateurSeul,
  )

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navigation principale"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-xs font-medium transition-colors active:scale-[0.98]',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex items-center justify-center rounded-full px-3 py-0.5 transition-all duration-200',
                      isActive && 'bg-primary/10',
                    )}
                  >
                    <Icon className={cn('size-5', isActive && 'stroke-[2.5]')} />
                  </span>
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
