import { describe, expect, it } from 'vitest'
import { construireChecklist, nbRestant, verifierMecaniquement } from '../../src/features/appel/checklist'

describe('contrôles mécaniques — cas réels rencontrés', () => {
  it('attrape le numéro à 12 chiffres (Viviane Pioche)', () => {
    const a = verifierMecaniquement({ client_telephone: '06 11 66 40 50 58' })
    expect(a.some((x) => x.gravite === 'bloquant')).toBe(true)
  })
  it('accepte un numéro valide', () => {
    expect(verifierMecaniquement({ client_telephone: '0613775266' })).toHaveLength(0)
  })
  it('rejette un email mal épelé', () => {
    expect(verifierMecaniquement({ client_email: 'marie.h.lancelot@gmail' })).toHaveLength(1)
  })
})

describe('checklist', () => {
  it('un champ non capté reste à demander', () => {
    const l = construireChecklist({ client_nom: 'Vincent Gossart', confiance: { client_nom: 0.95 } })
    expect(l.find((x) => x.cle === 'client_nom')!.etat).toBe('obtenu')
    expect(l.find((x) => x.cle === 'client_email')!.etat).toBe('manquant')
  })
  it('une confiance basse laisse le champ à confirmer', () => {
    const l = construireChecklist({ client_telephone: '0610131063', confiance: { client_telephone: 0.4 } })
    expect(l.find((x) => x.cle === 'client_telephone')!.etat).toBe('a_confirmer')
  })
  it("la question assurance n'apparaît que sur un sinistre", () => {
    expect(construireChecklist({ sinistre: 'aucun' }).some((x) => x.cle === 'assurance')).toBe(false)
    expect(construireChecklist({ sinistre: 'grele' }).some((x) => x.cle === 'assurance')).toBe(true)
  })
  it('compte ce qui reste avant de raccrocher', () => {
    expect(nbRestant(construireChecklist(null))).toBeGreaterThan(0)
    const complet = construireChecklist({
      client_nom: 'X', client_telephone: '0612345678', client_email: 'a@b.fr',
      client_adresse: '1 rue A', client_ville: 'Paris', metiers: ['Toiture'],
      probleme: 'fuite', surface: '50 m2', sinistre: 'aucun',
      confiance: { client_nom: 1, client_telephone: 1, client_email: 1, client_adresse: 1,
                   client_ville: 1, metiers: 1, probleme: 1, surface: 1 },
    })
    expect(nbRestant(complet)).toBe(0)
  })
})
