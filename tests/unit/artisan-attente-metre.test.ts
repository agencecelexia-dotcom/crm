import { describe, expect, it } from 'vitest'
import { bornerAttente, reprendreAttente } from '../../src/features/metre/attente-metre'

describe('Attente d’un calcul de métré distant', () => {
  it('conserve le début de la demande et s’arrête réellement à la limite', () => {
    const premier = bornerAttente({ statut: 'en_cours' }, undefined, 1000, 180000)
    const suivant = bornerAttente({ statut: 'en_cours' }, premier, 180999, 180000)
    expect(suivant).toMatchObject({ attenteDepuis: 1000, delaiDepasse: false })
    expect(bornerAttente({ statut: 'en_cours' }, suivant, 181000, 180000).delaiDepasse).toBe(true)
  })
  it('une réussite tardive reste une réussite, sans fausse erreur de délai', () => {
    const attente = bornerAttente({ statut: 'en_cours' }, undefined, 1000, 180000)
    expect(bornerAttente({ statut: 'fait' }, attente, 999999, 180000)).toMatchObject({ statut: 'fait', delaiDepasse: false, attenteDepuis: undefined })
  })
  it('réessayer accorde une nouvelle fenêtre sans transformer le statut distant', () => {
    const attente = { statut: 'en_cours', attenteDepuis: 1000, delaiDepasse: true }
    const reprise = reprendreAttente(attente, 200000)!
    expect(reprise).toEqual({ statut: 'en_cours', attenteDepuis: 200000, delaiDepasse: false })
    expect(bornerAttente({ statut: 'en_cours' }, reprise, 200001, 180000).delaiDepasse).toBe(false)
  })
  it('une nouvelle demande après un succès ne réutilise pas une ancienne échéance', () => {
    expect(bornerAttente({ statut: 'en_cours' }, { statut: 'fait', attenteDepuis: 1 }, 500000, 180000)).toMatchObject({ attenteDepuis: 500000, delaiDepasse: false })
  })
})
