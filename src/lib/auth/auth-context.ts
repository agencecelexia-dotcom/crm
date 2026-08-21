import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Membre } from '@/types/database'

/**
 * Contexte d'authentification.
 *
 * Porte la session Supabase ET le membre correspondant : le rôle décide de ce
 * que l'interface montre. Le cloisonnement réel est appliqué par la RLS côté
 * base (0100) — masquer une entrée de menu n'est qu'un confort, pas une
 * sécurité.
 */
export interface AuthContextType {
  session: Session | null
  /** Fiche membre du compte connecté. `null` tant qu'elle n'est pas chargée. */
  membre: Membre | null
  /** Raccourci de lecture : évite `membre?.role === 'fondateur'` partout. */
  estFondateur: boolean
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)
