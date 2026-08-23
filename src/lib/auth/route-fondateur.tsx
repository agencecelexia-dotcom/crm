import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from './use-auth'

/**
 * Garde de route réservée aux fondateurs.
 *
 * Masquer une entrée de menu ne suffit pas : une URL tapée à la main resterait
 * accessible. Cette garde ferme la porte côté navigation ; la RLS (migration
 * 0100) la ferme côté données — un commercial qui forcerait l'URL verrait un
 * écran vide plutôt que les commissions de l'agence.
 *
 * On redirige vers l'accueil plutôt que vers /login : la personne EST
 * connectée, elle n'a simplement pas ce droit. L'envoyer se reconnecter
 * laisserait croire à un problème de session.
 */
export function RouteFondateur() {
  const { session, estFondateur, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (!estFondateur) return <Navigate to="/" replace />

  return <Outlet />
}
