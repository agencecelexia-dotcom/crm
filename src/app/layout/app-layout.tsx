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
      <Sidebar />
      <Header />
      <main className="md:pl-56">
        <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 md:max-w-5xl md:px-8 md:pb-12 md:pt-8">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
