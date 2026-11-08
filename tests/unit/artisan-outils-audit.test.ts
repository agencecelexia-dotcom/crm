import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { csvDuRapport, rapportMetre, type EntreeRapport } from '../../src/features/metre/rapport-metre'
import type { LigneMetrage } from '../../src/features/metre/use-metrage'
import type { Releve } from '../../src/features/metre/releve'

const releve = JSON.parse(readFileSync(new URL('../fixtures/copc/deux-pans-simple/releve.json', import.meta.url), 'utf8')) as Releve
const metrage: LigneMetrage[] = [{
  cle: 'toit_surface', unite: 'm2', valeur_declaree: 95, declaree_par: 'client', citation: 'Environ 95 mètres carrés',
  valeur_mesuree: 104, mesure_source: 'lidar', statut: 'confirme', valeur_retenue: 112.5, retenue_par: 'artisan',
  note: 'Mesuré au télémètre sur place',
}]
const entree: EntreeRapport & { metrage: LigneMetrage[] } = {
  titre: 'Chantier de démonstration', adresse: 'Adresse fictive', date: new Date('2026-11-08T10:00:00Z'),
  releve, pans: null, photos: [], materiaux: null, metrage,
}

describe('audit : export des corrections humaines', () => {
  it('exporte la valeur confirmée, sa provenance et la mesure originale distinctement', () => {
    const rapport = rapportMetre(entree)
    const csv = csvDuRapport(rapport)
    expect(csv).toContain('112,5')
    expect(csv).toContain('Confirmé par l’artisan')
    expect(csv).toContain('Mesuré au télémètre sur place')
    expect(csv).toContain('104')
    const brut = rapportMetre({ ...entree, metrage: [] })
    expect(rapport.toiture).toEqual(brut.toiture)
    expect(rapport.facades).toEqual(brut.facades)
  })
})

it('une valeur seulement cohérente n’est pas présentée comme une confirmation humaine', () => {
  const rapport = rapportMetre({ ...entree, metrage: [{ ...metrage[0], statut: 'coherent', retenue_par: 'outil' }] })
  expect(rapport.dossier.some((l) => l.rubrique === 'Valeurs confirmées')).toBe(false)
  expect(csvDuRapport(rapport)).toContain('Estimation à vérifier')
  expect(csvDuRapport(rapport)).toContain('Déclaration, non vérifiée')
})

it('le PDF inclut les corrections, la provenance et les estimations initiales', async () => {
  const { construireRapport } = await import('../../src/features/metre/rapport-pdf')
  const document = await construireRapport(rapportMetre(entree), releve, null)
  const pdf = document.output()
  expect(pdf).toContain('112,5')
  expect(pdf).toContain('104')
  expect(pdf).toContain('Confirm')
  expect(pdf).toContain('Confiance')
  expect(pdf).toContain('Estimation initiale')
})
