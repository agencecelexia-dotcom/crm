import { Outlet } from 'react-router-dom'
import { Header } from './header'
import { BottomNav } from './bottom-nav'

// Coquille de l'app authentifiée : header en haut, contenu, bottom nav fixe.
export function AppLayout() {
  return (
    <div className="min-h-dvh bg-background">
      <Header />
      {/* pb-24 pour ne pas masquer le contenu sous la bottom nav */}
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
