import { Link } from 'react-router-dom'
import { ArrowUpRight, LogOut, Search } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { useAuth } from '@/lib/auth/use-auth'
import { useDroits } from '@/lib/auth/use-droits'
import { NavigationLinks } from './navigation-links'

export function Sidebar() {
  const { session, signOut, estFondateur } = useAuth()
  const { peutCreerLead } = useDroits()
  const email = session?.user.email ?? ''

  return (
    <aside className="crm-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col md:flex">
      <div className="px-6 pb-5 pt-7">
        <Link to="/" aria-label="Celexia — tableau de bord" className="inline-flex rounded-md focus-visible:outline-offset-4">
          <BrandLogo sombre className="h-7" />
        </Link>
        <p className="mt-2.5 text-xs text-[#a5a5af]">L’espace de votre agence</p>
      </div>
      <Link to="/projets" className="mx-4 mb-6 flex min-h-9 items-center gap-2.5 rounded-lg border border-white/10 px-3 text-xs text-[#c5c5ce] transition-colors hover:border-white/20 hover:bg-white/5">
        <Search className="size-4" strokeWidth={1.5} aria-hidden />
        Rechercher un projet
        <ArrowUpRight className="ml-auto size-3.5 text-[#8a8b96]" aria-hidden />
      </Link>
      <nav aria-label="Navigation principale" className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
        <NavigationLinks estFondateur={estFondateur} peutCreerLead={peutCreerLead} appearance="dark" />
      </nav>
      <div className="mx-4 shrink-0 border-t border-white/10 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-white" aria-hidden>{email.slice(0, 1).toUpperCase() || 'C'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[#ededf1]">{estFondateur ? 'Espace fondateur' : 'Espace commercial'}</p>
            <p className="mt-1 truncate text-[11px] text-[#a5a5af]" title={email}>{email}</p>
          </div>
          <button type="button" title="Se déconnecter" aria-label="Se déconnecter" onClick={() => void signOut()} className="grid size-8 shrink-0 place-items-center rounded-md text-[#a5a5af] transition-colors hover:bg-white/10 hover:text-white">
            <LogOut className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  )
}
