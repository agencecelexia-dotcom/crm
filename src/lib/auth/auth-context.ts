import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

// Contexte d'authentification simplifié : une session partagée, accès identique
// pour les 2 associés (pas de rôles). Séparé du provider pour le fast-refresh.
export interface AuthContextType {
  session: Session | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)
