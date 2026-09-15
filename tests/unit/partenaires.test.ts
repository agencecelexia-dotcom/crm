import { describe, expect, it } from 'vitest'
import { artisansCompatibles } from '../../src/features/projets/lib/artisans-compatibles'
import type { Artisan } from '../../src/types/database'

// Le statut partenaire ne sert qu'à un moment précis : attribuer un dossier.
// Ce qui compte, c'est l'ORDRE dans lequel le sélecteur propose les artisans.

function artisan(id: string, champs: Partial<Artisan> = {}): Artisan {
  return {
    id,
    nom: id,
    prenom: null,
    societe: null,
    metiers: ['Toiture'],
    sous_metiers: [],
    departements_couverts: [],
    zones_couvertes: [],
    rayon_km: null,
    latitude: null,
    longitude: null,
    partenaire_at: null,
    ...champs,
  } as Artisan
}

const PROJET_TOITURE = {
  metiers: ['Toiture'],
  latitude: null,
  longitude: null,
  client_code_postal: '21000',
}

const ordre = (liste: ReturnType<typeof artisansCompatibles>) => liste.map((c) => c.artisan.id)

describe('ordre du sélecteur d’attribution', () => {
  it('à métier égal, le partenaire passe devant', () => {
    const liste = artisansCompatibles(PROJET_TOITURE, [
      artisan('classique'),
      artisan('partenaire', { partenaire_at: '2026-09-15T00:00:00Z' }),
    ])
    expect(ordre(liste)).toEqual(['partenaire', 'classique'])
  })

  it('un partenaire sans le bon métier reste derrière un artisan qui l’a', () => {
    // Sans cette règle, Batryx serait proposé en tête sur un dossier de
    // piscine qu'il ne sait pas faire.
    const liste = artisansCompatibles({ ...PROJET_TOITURE, metiers: ['Piscine'] }, [
      artisan('partenaire-toiture', { partenaire_at: '2026-09-15T00:00:00Z' }),
      artisan('pisciniste', { metiers: ['Piscine'] }),
    ])
    expect(ordre(liste)).toEqual(['pisciniste', 'partenaire-toiture'])
  })

  it('le partenaire passe même devant un artisan qui couvre la zone', () => {
    const liste = artisansCompatibles(PROJET_TOITURE, [
      artisan('couvre-la-zone', { departements_couverts: ['21'] }),
      artisan('partenaire', { partenaire_at: '2026-09-15T00:00:00Z' }),
    ])
    expect(ordre(liste)).toEqual(['partenaire', 'couvre-la-zone'])
  })
})
