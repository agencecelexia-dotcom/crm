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
  // Distinct de `membre === null`, qui ne dit pas si la requête a répondu.
  // Vrai au départ : au premier rendu la fiche n'a pas encore été cherchée.
  // Repasse à false dès que la requête répond, quel que soit son résultat.
  const [membreEnCours, setMembreEnCours] = useState(true)
  const [isLoading, setIsLoading] = useState(true)

  // --- Session : synchrone, sans aucun appel réseau dans le callback.
  useEffect(() => {
    // `getSession()` peut ne JAMAIS se résoudre sur Chrome : il attend d'abord
    // l'initialisation interne, qui rafraîchit le jeton par le réseau — sans
    // aucun délai maximal — en tenant un verrou `navigator.locks`. Un onglet
    // resté bloqué garde ce verrou et fige tous les suivants. Safari, qui
    // n'implémente pas cette API, ne connaît pas le problème : c'est ce qui
    // explique qu'un même compte fonctionne ici et pas là.
    //
    // On ne peut donc pas se contenter d'attendre : on borne l'attente.
    let fini = false
    const relacher = (s: Session | null) => {
      if (fini) return
      fini = true
      setSession(s)
      setIsLoading(false)
    }

    const secours = setTimeout(() => {
      if (fini) return
      // Passé ce délai, la session locale est tenue pour inutilisable : mieux
      // vaut un écran de connexion qu'un chargement sans fin.
      console.warn('[auth] session illisible après 8 s — retour à la connexion')
      // Purge du jeton local : c'est lui que l'initialisation n'arrive pas à
      // rafraîchir. Le laisser en place rejouerait le blocage au rechargement
      // suivant, et la personne resterait prisonnière de la boucle. Seules les
      // clés d'auth sont retirées ; le reste du stockage n'est pas touché.
      try {
        for (const cle of Object.keys(localStorage)) {
          if (cle.startsWith('sb-')) localStorage.removeItem(cle)
        }
      } catch {
        // Stockage inaccessible (mode privé strict) : le retour à /login suffit.
      }
      relacher(null)
    }, 8000)

    supabase.auth
      .getSession()
      .then(({ data }) => relacher(data.session))
      .catch(() => relacher(null))
      .finally(() => clearTimeout(secours))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Une vraie réponse d'auth prime toujours sur le délai de secours.
      fini = true
      clearTimeout(secours)
      setSession(newSession)
      setIsLoading(false)
    })

    return () => {
      clearTimeout(secours)
      sub.subscription.unsubscribe()
    }
  }, [])

  // --- Fiche membre : effet séparé, déclenché par le changement de session.
  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return

    let annule = false

    // La RLS de `membres` (0099) ne laisse voir que sa propre fiche.
    //
    // Enveloppé dans une fonction asynchrone : le builder Supabase est un
    // `PromiseLike`, il n'expose ni `.catch` ni `.finally`.
    void (async () => {
      try {
        const { data } = await supabase
          .from('membres')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
        if (!annule) setMembre((data as Membre | null) ?? null)
      } catch {
        // Une panne réseau ne doit pas fermer le CRM à quelqu'un dont la
        // session est valide : on le traite comme « pas de fiche », donc avec
        // le périmètre le plus restreint.
        if (!annule) setMembre(null)
      } finally {
        // Posé dans TOUS les cas — réponse vide, erreur réseau, refus RLS.
        // C'est ce qui garantit que l'écran de chargement se termine.
        if (!annule) setMembreEnCours(false)
      }
    })()

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
        // Sans session, il n'y a rien à charger.
        membreEnCours: Boolean(session) && membreEnCours,
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
