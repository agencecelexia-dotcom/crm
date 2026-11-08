import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { creerIsolationSession, membrePourSession } from '../../src/lib/auth/isolation-session'
import type { Membre } from '../../src/types/database'

describe('isolation entre comptes', () => {
  it('retire les données privées et les mutations du compte précédent', () => {
    const cache = new QueryClient()
    const changer = creerIsolationSession(cache)
    changer('fondateur')
    cache.setQueryData(['projets'], [{ client_nom: 'Client confidentiel' }])
    cache.setQueryData(['artisans', '1', 'jeton'], 'lien-prive')
    cache.getMutationCache().build(cache, { mutationKey: ['modification-projet'] })

    changer('commercial')

    expect(cache.getQueryCache().getAll()).toHaveLength(0)
    expect(cache.getMutationCache().getAll()).toHaveLength(0)
  })

  it('vide le cache à la déconnexion mais le conserve au renouvellement du jeton', () => {
    const cache = new QueryClient()
    const changer = creerIsolationSession(cache)
    changer('fondateur')
    cache.setQueryData(['projets'], ['projet'])
    expect(changer('fondateur')).toBe(false)
    expect(cache.getQueryData(['projets'])).toEqual(['projet'])

    expect(changer(null)).toBe(true)
    expect(cache.getQueryData(['projets'])).toBeUndefined()
  })

  it('empêche une réponse tardive de réinjecter les données de l’ancien compte', async () => {
    const cache = new QueryClient()
    const changer = creerIsolationSession(cache)
    changer('fondateur')
    let repondre!: (value: string[]) => void
    const requete = cache.fetchQuery({
      queryKey: ['projets'],
      queryFn: () => new Promise<string[]>((resolve) => { repondre = resolve }),
    }).catch(() => undefined)

    changer('commercial')
    repondre(['dossier confidentiel'])
    await requete
    expect(cache.getQueryData(['projets'])).toBeUndefined()
  })

  it('ne transmet jamais les droits du fondateur au compte suivant', () => {
    const fiche = { userId: 'fondateur', membre: { role: 'fondateur', actif: true } as Membre }
    expect(membrePourSession('commercial', fiche)).toEqual({ membre: null, membreEnCours: true })
    expect(membrePourSession(undefined, fiche)).toEqual({ membre: null, membreEnCours: false })
    expect(membrePourSession('fondateur', fiche).membre?.role).toBe('fondateur')
  })

  it('termine le chargement quand le compte n’a aucune fiche membre', () => {
    expect(membrePourSession('sans-fiche', { userId: 'sans-fiche', membre: null }))
      .toEqual({ membre: null, membreEnCours: false })
  })
})
