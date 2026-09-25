import { describe, expect, it } from 'vitest'
import { coteLePlusProche, longueurCloture, parcelleDe, troncons } from '@/features/metre/parcelle'
import type { Point } from '@/features/metre/geometrie'

const LAT = 45.8
const m = (est: number, nord: number): Point => [4.87 + est / (111320 * Math.cos((LAT * Math.PI) / 180)), LAT + nord / 111320]

// Une parcelle de 20 × 30 m, dont le côté ouest a été numérisé en deux segments presque alignés.
const parcelle = parcelleDe('69292000AH0431', [m(0, 0), m(20, 0), m(20, 30), m(0, 30), m(0.1, 15)])

describe('parcelle', () => {
  it('mesure la surface et le tour', () => {
    expect(parcelle.surface).toBeCloseTo(600, -1)
    expect(parcelle.perimetre).toBeCloseTo(100, 0)
  })

  it('recolle les segments presque alignés : quatre côtés, comme sur le terrain', () => {
    expect(parcelle.cotes).toHaveLength(4)
    expect(parcelle.cotes.map((c) => Math.round(c.longueur)).sort((a, b) => a - b)).toEqual([20, 20, 30, 30])
  })

  it('la clôture est la somme des côtés cochés', () => {
    const sud = parcelle.cotes.find((c) => c.orientation === 'sud')!
    const est = parcelle.cotes.find((c) => c.orientation === 'est')!
    expect(longueurCloture(parcelle, new Set([sud.index, est.index]))).toBeCloseTo(50, 0)
    expect(longueurCloture(parcelle, new Set())).toBe(0)
  })

  it('le côté rue est celui qui longe l’adresse', () => {
    expect(coteLePlusProche(parcelle, m(10, -4))?.orientation).toBe('sud')
  })
})

describe('troncons', () => {
  const nom = (o: string) => parcelle.cotes.find((c) => c.orientation === o)!.index
  it('deux côtés voisins forment une seule ligne', () => {
    const t = troncons(parcelle, new Set([nom('sud'), nom('est')]))
    expect(t).toHaveLength(1)
    expect(t[0].ligne).toHaveLength(3)
  })
  it('deux côtés opposés restent deux lignes', () => {
    expect(troncons(parcelle, new Set([nom('sud'), nom('nord')]))).toHaveLength(2)
  })
  it('tout le tour se referme', () => {
    const t = troncons(parcelle, new Set(parcelle.cotes.map((c) => c.index)))
    expect(t).toHaveLength(1)
    expect(t[0].ligne[0]).toEqual(t[0].ligne[t[0].ligne.length - 1])
  })
})
