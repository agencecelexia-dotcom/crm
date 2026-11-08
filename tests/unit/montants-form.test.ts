import { describe, expect, it } from 'vitest'
import { champsMontants, patchMontants } from '../../src/features/projets/lib/montants-form'

const projet = {
  montant_devis: 18000, montant_devis_signe: null, estimation_interne: 15000,
  date_signature: null, taux_commission: 0.125,
}

describe('sauvegarde des montants', () => {
  it('préserve la signature reçue pendant une modification de l’estimation', () => {
    const modifications = { estimation_interne: '20000' }
    const apresSignature = { ...projet, montant_devis_signe: 17500, date_signature: '2026-11-07' }
    const patch = patchMontants(apresSignature, modifications)
    expect(patch).toEqual({ estimation_interne: 20000 })
    expect({ ...apresSignature, ...patch }).toMatchObject({
      montant_devis_signe: 17500, date_signature: '2026-11-07', taux_commission: 0.125,
    })
  })

  it('affiche les nouvelles données serveur dans les champs restés intacts', () => {
    const modifications = { estimation_interne: '20000' }
    const actualise = { ...projet, montant_devis_signe: 17500, date_signature: '2026-11-07' }
    expect({ ...champsMontants(actualise), ...modifications }).toMatchObject({
      estimation_interne: '20000', montant_devis_signe: '17500', date_signature: '2026-11-07',
    })
  })

  it('conserve les décimales du taux et n’envoie pas de modification fictive', () => {
    expect(champsMontants(projet).taux_commission).toBe('12.5')
    expect(patchMontants(projet, { taux_commission: '12,5', montant_devis: '18000.00' })).toEqual({})
  })

  it('envoie un effacement seulement lorsque le champ a été explicitement modifié', () => {
    const signe = { ...projet, montant_devis_signe: 17500, date_signature: '2026-11-07' }
    expect(patchMontants(signe, {})).toEqual({})
    expect(patchMontants(signe, { montant_devis_signe: '', date_signature: '' }))
      .toEqual({ montant_devis_signe: null, date_signature: null })
  })
})
