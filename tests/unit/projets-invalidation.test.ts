import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invaliderDonneesProjets } from '../../src/features/projets/lib/invalidation'

describe('actualisation des vues après modification d’un projet', () => {
  it('invalide les compteurs, commissions et indicateurs sans vider les données', async () => {
    const qc = new QueryClient()
    const cles = [
      ['projets'], ['projets', 'p1'], ['affectations', 'counts'],
      ['commissions-dues'], ['kpi-agence', null, null], ['ca-signe-par-mois', 6],
      ['a-traiter'], ['mon-pipe'], ['taches'],
    ]
    for (const cle of cles) qc.setQueryData(cle, 'donnees')
    qc.setQueryData(['parametre', 'signature'], 'signature')

    await invaliderDonneesProjets(qc)

    for (const cle of cles) {
      expect(qc.getQueryState(cle)?.isInvalidated).toBe(true)
      expect(qc.getQueryData(cle)).toBe('donnees')
    }
    expect(qc.getQueryState(['parametre', 'signature'])?.isInvalidated).toBe(false)
  })
})
