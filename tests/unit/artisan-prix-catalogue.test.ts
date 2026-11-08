import { describe, expect, it } from 'vitest'
import { preparerSuggestionsCatalogue } from '../../supabase/functions/_suggestions-catalogue'

const catalogue = [{ id: 'prix-fictif', designation: 'Nettoyage toiture', unite: 'm²', prix_unitaire: 15 }]
describe('suggestions : prix rattachés au catalogue côté serveur', () => {
  it('écarte le prix et la source inventés même avec un ouvrage connu', () => {
    const r = preparerSuggestionsCatalogue({ lignes: [{ designation: 'Nettoyage toiture', unite: 'm2', quantite: 80, prix_id: 'prix-fictif', prix_unitaire: 999, source: 'reference' }] }, catalogue)
    expect(r.lignes[0]).toEqual({ designation: 'Nettoyage toiture', unite: 'm2', quantite: 80, prix_id: 'prix-fictif', pourquoi: '' })
  })
  it.each([
    { designation: 'Remplacement toiture', unite: 'm²', prix_id: 'prix-fictif' },
    { designation: 'Nettoyage toiture', unite: 'u', prix_id: 'prix-fictif' },
    { designation: 'Nettoyage toiture', unite: 'm²', prix_id: 'identifiant-autre-artisan' },
  ])('ne rattache aucun prix à un autre ouvrage, une autre unité ou un identifiant absent : %j', ligne => {
    expect(preparerSuggestionsCatalogue({ lignes: [ligne] }, catalogue).lignes[0]).not.toHaveProperty('prix_id')
  })
  it('tolère une réponse invalide sans produire de ligne exploitable', () => {
    expect(preparerSuggestionsCatalogue(null, null)).toEqual({ lignes: [], manques: [] })
    expect(preparerSuggestionsCatalogue({ lignes: [null, 123, {}, { designation: ' ' }] }, [])).toEqual({ lignes: [], manques: [] })
  })
  it('conserve les explications utiles et borne les quantités non finies', () => {
    const r = preparerSuggestionsCatalogue({ lignes: [{ designation: 'Pose', quantite: Infinity, pourquoi: 'Surface à confirmer' }], manques: ['Mesurer sur place', 123] }, [])
    expect(r.lignes[0]).toEqual({ designation: 'Pose', unite: 'u', quantite: 1, pourquoi: 'Surface à confirmer' })
    expect(r.manques).toEqual(['Mesurer sur place'])
  })
})
