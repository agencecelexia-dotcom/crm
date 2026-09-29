import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { correctionsSurPlace, facadesSurPlace, noteSurPlace, type SaisieFacade } from '../../src/features/metre/calcul-sur-place'
import { facadeRetenue } from '../../supabase/functions/_releve-retenu'
import type { Releve } from '../../supabase/functions/_releve'

// Sur place : la cote relevée au mètre corrige la façade, les ouvertures
// ajoutées se déduisent, et rien ne part au dossier avant que toutes les
// façades soient vues.

const DOSSIER = fileURLToPath(new URL('../fixtures/copc', import.meta.url))
const r = JSON.parse(readFileSync(join(DOSSIER, 'deux-pans-simple', 'releve.json'), 'utf8')) as Releve

describe('sur place', () => {
  const sans = facadesSurPlace(r, [], {})
  const [f] = sans

  it('part du relevé, sans rien corriger', () => {
    expect(f.bruteCorrigee).toBe(facadeRetenue(r, f.orientation).surface)
    expect(f.nette).toBe(f.bruteCorrigee)
    expect(f.corrigee).toBe(false)
  })

  it('une longueur mesurée change toute la surface, une hauteur la bande sous la gouttière', () => {
    const [g] = facadesSurPlace(r, [], { [f.orientation]: { longueur: f.longueur * 1.1 } })
    expect(g.bruteCorrigee).toBeCloseTo(f.brute * 1.1, 1)
    const [h] = facadesSurPlace(r, [], { [f.orientation]: { hauteur: f.hauteur + 0.5 } })
    expect(h.bruteCorrigee).toBeCloseTo(f.brute + f.longueur * 0.5, 1)
  })

  it('déduit les ouvertures ajoutées à la main', () => {
    const [g] = facadesSurPlace(r, [], { [f.orientation]: { ajoutees: 2 } })
    expect(g.ouvertures).toMatchObject({ nombre: 2, surface: 3 })
    expect(g.nette).toBeCloseTo(f.brute - 3, 1)
  })

  it('n’envoie rien tant qu’une façade reste à voir', () => {
    const presque = Object.fromEntries(sans.slice(1).map((x) => [x.orientation, { vue: true }]))
    expect(correctionsSurPlace(facadesSurPlace(r, [], presque), presque)).toEqual([])
  })

  it('envoie brute, ouvertures, nette — et la hauteur mesurée', () => {
    const toutes: Record<string, SaisieFacade> = Object.fromEntries(sans.map((x) => [x.orientation, { vue: true }]))
    toutes[f.orientation] = { vue: true, hauteur: 5.2, ajoutees: 1 }
    const fs = facadesSurPlace(r, [], toutes)
    const c = Object.fromEntries(correctionsSurPlace(fs, toutes).map((x) => [x.cle, x.valeur]))
    expect(Object.keys(c).sort()).toEqual(['facade_nette', 'facades_total', 'hauteur_murs', 'ouvertures', 'ouvertures_surface'])
    expect(c.facade_nette).toBeCloseTo(c.facades_total - c.ouvertures_surface, 1)
    expect(c.hauteur_murs).toBe(5.2)
    expect(noteSurPlace(fs, toutes, new Date('2026-09-29'))).toMatch(/^Sur place le 29\/09\/2026 : .*H 5.2 m/)
  })
})
