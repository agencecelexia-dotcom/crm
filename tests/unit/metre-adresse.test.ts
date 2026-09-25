import { describe, expect, it } from 'vitest'
import {
  lieuSaisi,
  memeCommune,
  memeRue,
  numeroNormalise,
  numeroSaisi,
  requeteAdresse,
  voieSaisie,
} from '../../supabase/functions/_adresse'

// Les cas viennent de chantiers réels : ce sont eux qui faisaient demander
// « C'est bien la maison ? » à tort, ou qui l'auraient tu à tort.

describe('requeteAdresse', () => {
  it('ne répète pas le code postal ni la ville déjà dans l’adresse', () => {
    // Répétés, ils faisaient tomber le score BAN de 0,979 à 0,635.
    expect(requeteAdresse('22 rue de la Griesmatt, 67100 Strasbourg', '67100', 'Strasbourg')).toBe(
      '22 rue de la Griesmatt, 67100 Strasbourg',
    )
  })
  it('les ajoute quand l’adresse ne les porte pas', () => {
    expect(requeteAdresse('2 rue du Centre', '21320', 'Essey')).toBe('2 rue du Centre 21320 Essey')
  })
  it('reconnaît la ville déjà écrite autrement', () => {
    expect(requeteAdresse('19 rue Étroite, Alby-sur-Chéran', null, 'ALBY-SUR-CHÉRAN')).toBe(
      '19 rue Étroite, Alby-sur-Chéran',
    )
  })
})

describe('lieuSaisi', () => {
  it('lit le code postal et la commune qui le suit', () => {
    expect(lieuSaisi('1 allée des Sapins, 69580 Sathonay-Village')).toEqual({
      codePostal: '69580',
      commune: 'Sathonay-Village',
    })
  })
  it('lit la commune qui précède le code postal', () => {
    expect(lieuSaisi('30 rue des Albères, Canet-en-Roussillon 66140')).toEqual({
      codePostal: '66140',
      commune: 'Canet-en-Roussillon',
    })
  })
  it('ne devine rien sans code postal', () => {
    expect(lieuSaisi('2 rue du Centre')).toEqual({ codePostal: null, commune: null })
  })
})

describe('voieSaisie', () => {
  it('garde la voie, sans le code postal ni la commune', () => {
    expect(voieSaisie('1 allée des Sapins, 69580 Sathonay-Village')).toBe('1 allée des Sapins')
    expect(voieSaisie('22 rue de la Griesmatt 67100 Strasbourg')).toBe('22 rue de la Griesmatt')
    expect(voieSaisie('30 rue des Albères, Canet-en-Roussillon 66140')).toBe('30 rue des Albères')
  })
  it('trouve la voie numérotée après un nom de résidence', () => {
    expect(voieSaisie('Résidence Les Pins, 12 rue Victor Hugo, 75011 Paris')).toBe('12 rue Victor Hugo')
  })
})

describe('memeCommune', () => {
  it('ignore accents, casse, tirets et espaces', () => {
    expect(memeCommune('abbansdessus', 'Abbans-Dessus')).toBe(true)
    expect(memeCommune('ALBY-SUR-CHÉRAN', 'Alby-sur-Chéran')).toBe(true)
    expect(memeCommune('St Aygulf', 'Saint-Aygulf')).toBe(true)
  })
  it('distingue deux communes voisines', () => {
    expect(memeCommune('Sathonay-Village', 'Sathonay-Camp')).toBe(false)
    expect(memeCommune('Landerneau', 'Saint-Urbain')).toBe(false)
  })
  it('ne confond pas « rien » avec une commune', () => {
    expect(memeCommune(null, 'Nice')).toBe(false)
    expect(memeCommune('', '')).toBe(false)
  })
})

describe('memeRue', () => {
  it('accepte la même rue, à l’écriture près', () => {
    expect(memeRue('27 rue du champ fleuri', 'Rue du Champ Fleuri')).toBe(true)
    expect(memeRue("10 rue de l'École", 'Rue de l’Ecole')).toBe(true)
    expect(memeRue('217 rue Émile Zola', 'Rue Emile Zola')).toBe(true)
  })
  it('tolère une faute de frappe', () => {
    expect(memeRue('27 rue du champ fleurie', 'Rue du Champ Fleuri')).toBe(true)
  })
  it('tolère un nom abrégé', () => {
    expect(memeRue('3 av de gaulle', 'Avenue du Général de Gaulle')).toBe(true)
  })
  it('refuse le même numéro dans une autre rue', () => {
    // La BAN rendait « 25 Rue du Chatelot » pour « 25 rue du fraine ».
    expect(memeRue('25 rue du fraine', 'Rue du Chatelot')).toBe(false)
    expect(memeRue("32 chemin de l'Étang", 'Rue de Dimbsthal')).toBe(false)
  })
})

describe('numéro', () => {
  it('lit le numéro et son suffixe', () => {
    expect(numeroSaisi('1B allée de Balanec')).toBe('1B')
    expect(numeroSaisi('12 bis rue Haute')).toBe('12 bis')
    expect(numeroSaisi('1 allée des Sapins')).toBe('1')
    expect(numeroSaisi('3 r du Moulin')).toBe('3')
    expect(numeroSaisi('rue du Moulin')).toBeNull()
  })
  it('égale « 12 bis » et « 12B », pas « 12 » et « 12B »', () => {
    expect(numeroNormalise('12 bis')).toBe(numeroNormalise('12B'))
    expect(numeroNormalise('12')).not.toBe(numeroNormalise('12B'))
    expect(numeroNormalise(numeroSaisi('23 rue X'))).not.toBe(numeroNormalise('25'))
  })
})
