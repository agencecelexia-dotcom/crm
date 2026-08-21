import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { AuthContext } from './auth-context'
import type { Membre } from '@/types/database'

// Provider d'authentification : suit la session Supabase, charge la fiche
// membre associée, et expose signIn/signOut.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [membre, setMembre] = useState<Membre | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // La RLS de `membres` (0099) ne laisse voir que sa propre fiche : pas besoin
  // de filtrer ici, `maybeSingle` suffit.
  const chargerMembre = useCallback(async (s: Session | null) => {
    if (!s) {
      setMembre(null)
      return
    }
    const { data } = await supabase
      .from('membres')
      .select('*')
      .eq('user_id', s.user.id)
      .maybeSingle()
    setMembre((data as Membre | null) ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await chargerMembre(data.session)
      setIsLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      await chargerMembre(newSession)
      setIsLoading(false)
    })

    return () => sub.subscription.unsubscribe()
  }, [chargerMembre])

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
        membre,
        // Un compte sans fiche membre n'est pas fondateur : le défaut est le
        // périmètre le plus restreint, jamais l'inverse.
        estFondateur: membre?.role === 'fondateur' && membre.actif,
        isLoading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
