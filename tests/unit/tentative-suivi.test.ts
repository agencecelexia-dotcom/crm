import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let stockage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  stockage = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (cle: string) => stockage.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => stockage.set(cle, valeur),
    removeItem: (cle: string) => stockage.delete(cle),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('tentatives de suivi après une réponse perdue', () => {
  const token = 'jeton-affectation-fictif'
  const note = { p_message: 'Texte privé fictif, téléphone 0123456789' }

  it('conserve la clé après réouverture sans persister la note ni le jeton', async () => {
    const premier = await import('../../src/features/contrats/tentative-suivi')
    const tentative = await premier.obtenirTentativeSuivi(token, 'suivi', note)
    expect(JSON.stringify([...stockage])).not.toContain(token)
    expect(JSON.stringify([...stockage])).not.toContain('Texte privé')
    expect(JSON.stringify([...stockage])).not.toContain('0123456789')
    expect(tentative.emplacement).toMatch(/^crm:suivi:v1:[a-f0-9]{64}$/)
    expect(tentative.cle).toMatch(/^[a-f0-9-]{36}$/)
    vi.resetModules()
    const rouvert = await import('../../src/features/contrats/tentative-suivi')
    expect(await rouvert.obtenirTentativeSuivi(token, 'suivi', note)).toEqual(tentative)
  })

  it('sépare les affectations, les actions et les textes', async () => {
    const { obtenirTentativeSuivi } = await import('../../src/features/contrats/tentative-suivi')
    const tentatives = await Promise.all([
      obtenirTentativeSuivi(token, 'suivi', note),
      obtenirTentativeSuivi('autre-affectation', 'suivi', note),
      obtenirTentativeSuivi(token, 'appel', note),
      obtenirTentativeSuivi(token, 'suivi', { p_message: 'Nouveau texte' }),
    ])
    expect(new Set(tentatives.map((t) => t.cle)).size).toBe(4)
  })

  it('un succès autorise ensuite une nouvelle note volontairement identique', async () => {
    const { obtenirTentativeSuivi, confirmerTentativeSuivi } = await import('../../src/features/contrats/tentative-suivi')
    const tentative = await obtenirTentativeSuivi(token, 'suivi', note)
    confirmerTentativeSuivi(tentative)
    expect(stockage.size).toBe(0)
    expect((await obtenirTentativeSuivi(token, 'suivi', note)).cle).not.toBe(tentative.cle)
  })

  it('garde la protection dans l’onglet si le navigateur refuse le stockage', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('Stockage interdit') },
      setItem: () => { throw new Error('Stockage interdit') },
      removeItem: () => { throw new Error('Stockage interdit') },
    })
    const { obtenirTentativeSuivi } = await import('../../src/features/contrats/tentative-suivi')
    expect(await obtenirTentativeSuivi(token, 'suivi', note)).toEqual(await obtenirTentativeSuivi(token, 'suivi', note))
  })
})
