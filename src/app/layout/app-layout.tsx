import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Header } from './header'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'

// Coquille de l'app authentifiée :
//  - mobile : header en haut + bottom nav fixe
//  - desktop (md+) : barre latérale gauche + contenu élargi
export function AppLayout() {
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#contenu-principal"
        className="sr-only fixed left-4 top-4 z-[100] rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground focus:not-sr-only focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Aller au contenu
      </a>
      <Sidebar />
      <Header />
      <main id="contenu-principal" tabIndex={-1} className="outline-none md:pl-60">
        <div className="mx-auto max-w-[1520px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-12 md:pt-8">
          <Suspense fallback={<div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" aria-hidden />Chargement de l’écran…</div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
