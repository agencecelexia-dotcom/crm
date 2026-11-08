import type { QueryClient } from '@tanstack/react-query'
import type { Membre } from '@/types/database'

export interface FicheMembreChargee {
  userId: string
  membre: Membre | null
}

/** Une session ne peut jamais réutiliser la fiche d'un autre compte. */
export function membrePourSession(userId: string | undefined, fiche: FicheMembreChargee | null) {
  const chargee = Boolean(userId && fiche?.userId === userId)
  return {
    membre: chargee ? fiche!.membre : null,
    membreEnCours: Boolean(userId) && !chargee,
  }
}

/** Vide également les requêtes en cours avant de rendre la nouvelle session. */
export function creerIsolationSession(cache: Pick<QueryClient, 'clear'>) {
  let userId: string | null = null
  return (prochainId: string | null) => {
    if (prochainId === userId) return false
    userId = prochainId
    cache.clear()
    return true
  }
}
