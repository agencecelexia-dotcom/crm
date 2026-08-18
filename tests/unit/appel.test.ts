import { describe, expect, it } from 'vitest'
import { construireChecklist, divergences, fusionner, nbRestant, verifierMecaniquement } from '../../src/features/appel/checklist'

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

describe('double saisie : clavier + écoute', () => {
  it('la frappe prime sur l’extraction', () => {
    const l = construireChecklist(
      { client_telephone: '0613707752', confiance: { client_telephone: 0.9 } },
      { client_telephone: '0613775266' },
    )
    const tel = l.find((x) => x.cle === 'client_telephone')!
    expect(tel.valeur).toBe('0613775266')
    expect(tel.etat).toBe('saisi')
  })

  it('signale un écart entre la frappe et l’écoute', () => {
    const l = construireChecklist(
      { client_telephone: '0613707752', confiance: { client_telephone: 0.9 } },
      { client_telephone: '0613775266' },
    )
    expect(divergences(l)).toHaveLength(1)
    expect(l.find((x) => x.cle === 'client_telephone')!.suggestionIa).toBe('0613707752')
  })

  it('ne signale pas un écart de simple mise en forme', () => {
    const l = construireChecklist(
      { client_telephone: '0612345678', confiance: { client_telephone: 0.9 } },
      { client_telephone: '06 12 34 56 78' },
    )
    expect(divergences(l)).toHaveLength(0)
  })

  it('ignore les accents et la casse', () => {
    const l = construireChecklist(
      { client_ville: 'Saint-Rome-de-Cernon', confiance: { client_ville: 0.9 } },
      { client_ville: 'saint rome de cernon' },
    )
    expect(divergences(l)).toHaveLength(0)
  })

  it('vider un champ rend la main à l’extraction', () => {
    const l = construireChecklist(
      { client_nom: 'Aubigeon', confiance: { client_nom: 0.9 } },
      { client_nom: '' },
    )
    const nom = l.find((x) => x.cle === 'client_nom')!
    expect(nom.valeur).toBe('Aubigeon')
    expect(nom.etat).toBe('obtenu')
  })

  it('un champ saisi ne compte plus dans le restant', () => {
    const avant = construireChecklist({ confiance: {} })
    const apres = construireChecklist({ confiance: {} }, { client_nom: 'Aubigeon' })
    expect(nbRestant(apres)).toBe(nbRestant(avant) - 1)
  })

  it('fusionner : la saisie écrase, le reste est conservé', () => {
    const f = fusionner(
      { client_nom: 'Aubi', client_ville: 'Lyon', confiance: { client_nom: 0.3 } },
      { client_nom: 'Aubigeon' },
    )
    expect(f.client_nom).toBe('Aubigeon')
    expect(f.client_ville).toBe('Lyon')
  })

  it('fusionner : les métiers saisis deviennent un tableau', () => {
    expect(fusionner(null, { metiers: 'Toiture, Charpente' }).metiers).toEqual(['Toiture', 'Charpente'])
  })
})

describe('recoupement : les deux sources restent visibles', () => {
  it("la valeur de l'IA reste exposée même quand le champ est saisi", () => {
    const l = construireChecklist(
      { client_nom: 'Aubigeon', confiance: { client_nom: 0.9 } },
      { client_nom: 'Aubigeon' },
    )
    const nom = l.find((x) => x.cle === 'client_nom')!
    expect(nom.valeurIa).toBe('Aubigeon')   // l'IA a bien noté, on la voit
    expect(nom.suggestionIa).toBeNull()      // mais pas d'alerte : ça concorde
  })

  it('concordance et divergence se distinguent', () => {
    const concorde = construireChecklist(
      { client_nom: 'Aubigeon', confiance: { client_nom: 0.9 } },
      { client_nom: 'Aubigeon' },
    ).find((x) => x.cle === 'client_nom')!
    const diverge = construireChecklist(
      { client_nom: 'Obligeant', confiance: { client_nom: 0.5 } },
      { client_nom: 'Aubigeon' },
    ).find((x) => x.cle === 'client_nom')!

    expect(concorde.valeurIa).toBe('Aubigeon')
    expect(concorde.suggestionIa).toBeNull()
    expect(diverge.valeurIa).toBe('Obligeant')
    expect(diverge.suggestionIa).toBe('Obligeant')
  })

  it("la confiance de l'IA est transmise", () => {
    const l = construireChecklist(
      { client_telephone: '0613707752', confiance: { client_telephone: 0.4 } },
      { client_telephone: '0613775266' },
    ).find((x) => x.cle === 'client_telephone')!
    expect(l.confianceIa).toBe(0.4)
  })
})
