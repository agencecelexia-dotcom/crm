import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const etat = vi.hoisted(() => ({
  projets: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  dues: { data: new Set<string>(), isPending: false, isError: false, refetch: vi.fn() },
}))

vi.mock('@tanstack/react-query', () => ({ useQuery: () => etat.dues }))
vi.mock('../../src/features/projets/hooks/use-projets', () => ({
  useProjets: () => etat.projets,
  usePatchProjet: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../src/lib/supabase/client', () => ({ supabase: { rpc: vi.fn() } }))

import { CommissionsPage } from '../../src/features/commissions/commissions-page'

function rendu() {
  return renderToStaticMarkup(<MemoryRouter><CommissionsPage /></MemoryRouter>)
}

describe('états du solde de commissions', () => {
  beforeEach(() => {
    etat.projets.isPending = false
    etat.projets.isError = false
    etat.dues.isPending = false
    etat.dues.isError = false
  })

  it('n’affiche pas un solde nul avant la réponse de commissions_dues', () => {
    etat.dues.isPending = true
    const html = rendu()
    expect(html).not.toContain('Total à encaisser')
    expect(html).not.toContain('Aucune commission à encaisser')
  })

  it.each(['projets', 'dues'] as const)('signale l’échec %s sans annoncer que tout est encaissé', (source) => {
    etat[source].isError = true
    const html = rendu()
    expect(html).toContain('Commissions indisponibles')
    expect(html).toContain('Réessayer')
    expect(html).not.toContain('Total à encaisser')
    expect(html).not.toContain('Aucune commission à encaisser')
  })

  it('annonce un solde vide seulement après deux réponses réussies', () => {
    const html = rendu()
    expect(html).toContain('Aucune commission à encaisser')
    expect(html).toContain('Total à encaisser')
  })
})
