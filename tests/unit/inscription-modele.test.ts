import { describe, expect, it } from 'vitest'
import { metiersInscription, preparerInscription, schemaBrouillonInscription, validerInscription } from '../../src/features/artisans/inscription-modele'

const complet = () => schemaBrouillonInscription.parse({ nom: ' Durand ', telephone: '+33 6 12 34 56 78', email: 'sam@example.test', societe: 'Atelier', siren: '123 456 789 00012', adresse: '1 rue fictive', ville: 'Lyon', code_postal: '69001', metiers: ['Peinture'], zones: [{ ville: 'Lyon', cp: '69001', rayon: 30 }] })
describe('inscription publique : validation et conservation des secteurs', () => {
  it('autorise le prénom et les informations complémentaires absents', () => {
    for (const etape of [0, 1, 2]) expect(validerInscription(complet(), etape)).toEqual({})
  })
  it('explique les formats erronés au niveau de chaque champ', () => {
    const d = { ...complet(), telephone: 'abc123456', email: 'sam@', siren: '1', code_postal: '12' }
    expect(Object.keys(validerInscription(d, 0))).toEqual(['telephone', 'email'])
    expect(Object.keys(validerInscription(d, 1))).toEqual(['siren', 'code_postal'])
  })
  it('ne perd pas les métiers libres, supprime les doublons et spécialités orphelines', () => {
    const d = { ...complet(), autre_metier: 'peinture, Ferronnerie', sous_metiers: ['Peinture intérieure', 'Toiture tuiles'] }
    expect(metiersInscription(d)).toEqual(['Peinture', 'Ferronnerie'])
    expect(preparerInscription(d, []).sous_metiers).toEqual(['Peinture intérieure'])
  })
  it('demande une ville complète et repère chaque secteur incomplet', () => {
    const d = { ...complet(), zones: [{ ville: '', cp: '123', rayon: 30 }] }
    expect(Object.keys(validerInscription(d, 2))).toEqual(['zone-ville-0', 'zone-cp-0'])
  })
  it('ne mélange pas départements et rayons après changement de mode', () => {
    const d = { ...complet(), mode: 'departements' as const, departements: ['69'] }
    const zone = { ville: 'Lyon', lat: 45.7, lon: 4.8, rayon_km: 30 }
    expect(preparerInscription(d, [zone])).toMatchObject({ zones_couvertes: [], departements_couverts: ['69'] })
    expect(preparerInscription({ ...d, mode: 'rayon' }, [zone])).toMatchObject({ zones_couvertes: [zone], departements_couverts: [] })
  })
  it('normalise le SIRET en SIREN sans déduire une forme juridique des effectifs', () => {
    expect(preparerInscription({ ...complet(), nb_salaries: '0' }, [])).toMatchObject({ siren: '123456789', nb_salaries: 0, forme_juridique: null, representant: 'Durand' })
  })
  it('refuse un département inventé et les effectifs négatifs', () => {
    const erreurs = validerInscription({ ...complet(), mode: 'departements', departements: ['XYZ'], nb_salaries: '-1' }, 2)
    expect(Object.keys(erreurs)).toEqual(['nb_salaries', 'departements'])
  })
})
