import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { debordCourt, debordLisible, moisDuVol, provenanceToit, resumePansReleve } from '@/features/metre/affichage-releve'
import { geometrieElevation } from '@/features/metre/croquis'
import type { Releve } from '@/features/metre/releve'

const releve = (nom: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/copc/${nom}/releve.json`, import.meta.url)), 'utf8')) as Releve

describe('les pans en une phrase', () => {
  it('regroupe les pentes à 3 points près', () => {
    expect(resumePansReleve([{ pente: 35, orientation: 'nord' }, { pente: 35.2, orientation: 'sud' }, { pente: 34.3, orientation: 'est' }, { pente: 34.7, orientation: 'ouest' }])).toBe('4 pans à 35 %')
    expect(resumePansReleve([{ pente: 58, orientation: 'nord' }, { pente: 30, orientation: 'sud' }])).toBe('1 pan à 30 %, 1 pan à 58 %')
  })
  it('dit la partie plate', () => {
    expect(resumePansReleve([{ pente: 2, orientation: 'plat' }, { pente: 30, orientation: 'sud' }])).toBe('1 pan à 30 %, une partie plate')
  })
})

describe('le débord mesuré, en clair', () => {
  it('donne l’étendue quand les côtés diffèrent', () => {
    const r = releve('deux-pans-simple')
    expect(debordCourt(r)).toBe('34–72 cm')
    expect(debordLisible(r)).toBe('34 à 72 cm selon les côtés')
  })
  it('ne dit pas « −15 cm » : un toit plus court que le cadastre n’a pas de débord', () => {
    expect(debordCourt(releve('deux-pans-raides'))).toBe('aucun')
    expect(debordLisible(releve('deux-pans-raides'))).toBe('aucun')
  })
})

it('date le vol en mois', () => {
  expect(moisDuVol('2021-09-24')).toBe('septembre 2021')
  expect(moisDuVol(null)).toBeNull()
})

it('la provenance du toit dit la source, le vol, le recalage et la précision', () => {
  const lignes = provenanceToit(releve('deux-pans-simple')).join('\n')
  expect(lignes).toContain('LiDAR HD de l’IGN')
  expect(lignes).toContain('septembre 2021')
  expect(lignes).toContain('recalé de 46 cm')
  expect(lignes).toMatch(/Précision : ±5 cm sur le bord du toit, soit ±[\d,]+ m²/)
})

describe('l’élévation d’une façade', () => {
  const r = releve('accolee')
  it('dessine le pignon plus haut que ses bouts, sol en bas', () => {
    const pignon = r.facades.find((f) => f.type === 'pignon' && f.accole === 0)!
    const g = geometrieElevation([pignon], 320)!
    const ys = g.murs[0].contour.map((p) => p[1])
    expect(Math.max(...ys)).toBeCloseTo(g.sol, 5)
    // Le faîte (plus petit y) est au milieu du mur.
    const sommet = g.murs[0].contour.reduce((a, b) => (b[1] < a[1] ? b : a))
    const xs = g.murs[0].contour.map((p) => p[0])
    const milieu = (Math.min(...xs) + Math.max(...xs)) / 2
    expect(Math.abs(sommet[0] - milieu)).toBeLessThan((Math.max(...xs) - Math.min(...xs)) * 0.15)
    expect(g.murs[0].hauteurs).toHaveLength(2)
  })
  it('hachure toute la partie mitoyenne', () => {
    const mitoyen = r.facades.find((f) => f.accole > 9)!
    const g = geometrieElevation([mitoyen], 320)!
    expect(g.murs[0].mitoyens).toHaveLength(1)
  })
  it('tient dans la largeur donnée', () => {
    const g = geometrieElevation(r.facades, 320)!
    for (const m of g.murs) for (const [x] of m.contour) expect(x).toBeLessThanOrEqual(320)
  })
})
