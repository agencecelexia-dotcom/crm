import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { AuthContext } from './auth-context'
import type { Membre } from '@/types/database'

/**
 * Provider d'authentification : suit la session Supabase et charge la fiche
 * membre associée, qui porte le rôle.
 *
 * DEUX PIÈGES, tous deux rencontrés en production :
 *
 * 1. Ne JAMAIS attendre une requête Supabase à l'intérieur du callback
 *    `onAuthStateChange`. Le client détient un verrou interne pendant son
 *    exécution : toute requête lancée depuis ce callback attend un verrou qui
 *    ne se libérera qu'à sa fin — interblocage, et l'écran de chargement
 *    tourne indéfiniment. La session est donc posée dans un état, et la fiche
 *    membre chargée par un effet séparé.
 *
 * 2. `isLoading` ne doit dépendre que de la SESSION, pas du chargement du
 *    membre. Sinon une erreur réseau sur `membres` bloquerait l'accès au CRM
 *    à quelqu'un dont la session est parfaitement valide.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [membre, setMembre] = useState<Membre | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // --- Session : synchrone, sans aucun appel réseau dans le callback.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setIsLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setIsLoading(false)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  // --- Fiche membre : effet séparé, déclenché par le changement de session.
  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return

    let annule = false

    // La RLS de `membres` (0099) ne laisse voir que sa propre fiche.
    supabase
      .from('membres')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!annule) setMembre((data as Membre | null) ?? null)
      })

    return () => {
      annule = true
    }
  }, [session?.user.id])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        // Déduit plutôt que stocké : effacer la fiche dans un effet
        // déclencherait un rendu en cascade au moment de la déconnexion.
        membre: session ? membre : null,
        // Un compte sans fiche membre n'est pas fondateur : le défaut est le
        // périmètre le plus restreint, jamais l'inverse.
        estFondateur: Boolean(session) && membre?.role === 'fondateur' && membre.actif,
        isLoading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
