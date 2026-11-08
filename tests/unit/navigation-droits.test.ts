import { describe, expect, it } from 'vitest'
import { navigationPourRole } from '../../src/app/layout/navigation'

const routes = (fondateur: boolean, creation: boolean) =>
  navigationPourRole(fondateur, creation).flatMap((groupe) => groupe.items.map((item) => item.to))

describe('droits dans la navigation commune', () => {
  it('ne propose pas la prise d’appel à un commercial sans droit de création', () => {
    const liens = routes(false, false)
    expect(liens).not.toContain('/appel')
    expect(liens).toContain('/projets')
    expect(liens).toContain('/mon-pipe')
  })

  it('propose la prise d’appel au commercial autorisé et au fondateur', () => {
    expect(routes(false, true)).toContain('/appel')
    expect(routes(true, true)).toContain('/appel')
  })

  it('ne confond pas création de projets et accès aux écrans fondateur', () => {
    expect(routes(false, true)).not.toContain('/commissions')
    expect(routes(true, true)).toContain('/commissions')
    expect(routes(true, true)).not.toContain('/mon-pipe')
  })
})
