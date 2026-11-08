import { describe, expect, it } from 'vitest'
import { traceManuelAffichable, traceManuelModifiable, traceModifie } from '../../src/features/metre/edition-trace'
import type { Metre } from '../../src/features/metre/use-metres'

const dessin = { nom: 'Terrasse', type: 'surface', source: 'dessin', geometrie: [[2,48],[2.001,48],[2.001,48.001]], surface_m2: 10, surface_reelle_m2: null, pente_pct: null, hauteur_m: null, modifiable_trace: true } as Metre

describe('Carnet : capacité serveur et protection du relevé', () => {
  it('reste consultable quand la capacité serveur manque ou refuse', () => {
    expect(traceManuelAffichable({ ...dessin, modifiable_trace: false })).toBe(true)
    expect(traceManuelModifiable({ ...dessin, modifiable_trace: false })).toBe(false)
    expect(traceManuelModifiable({ ...dessin, modifiable_trace: undefined })).toBe(false)
    expect(traceManuelModifiable(dessin)).toBe(true)
  })
  it.each([{ source: 'bati' }, { type: 'facade' }, { pente_pct: 20 }, { hauteur_m: 4 }, { releve_id: 'releve-existant' }, { surface_reelle_m2: 12 }])('ne transforme pas le relevé dérivé %j en dessin plat', (special) => {
    expect(traceManuelModifiable({ ...dessin, ...special } as Metre)).toBe(false)
  })
  it('accepte l’ancien dessin plat dont la surface réelle répétait la surface', () => {
    expect(traceManuelModifiable({ ...dessin, surface_reelle_m2: 10 })).toBe(true)
  })
  it('protège le nom ou un point changé, pas une simple réouverture', () => {
    expect(traceModifie(dessin, 'Terrasse ', dessin.geometrie.map((p) => [...p]))).toBe(false)
    expect(traceModifie(dessin, 'Terrasse nord', dessin.geometrie)).toBe(true)
    expect(traceModifie(dessin, dessin.nom, [[2,48],[2.002,48],[2.001,48.001]])).toBe(true)
  })
})
