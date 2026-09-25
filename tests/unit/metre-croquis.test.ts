import { describe, expect, it } from 'vitest'
import { geometrieCroquis } from '@/features/metre/croquis'
import type { Point } from '@/features/metre/geometrie'

const LAT = 45.8
const m = (est: number, nord: number): Point => [4.87 + est / (111320 * Math.cos((LAT * Math.PI) / 180)), LAT + nord / 111320]
// Une maison de 12 m (est-ouest) sur 6 m (nord-sud).
const maison: Point[] = [m(0, 0), m(12, 0), m(12, 6), m(0, 6)]

describe('croquis coté', () => {
  const g = geometrieCroquis(maison, 320)!

  it('garde les proportions : deux fois plus large que haute', () => {
    const xs = g.contour.map((p) => p[0])
    const ys = g.contour.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    expect(w / h).toBeCloseTo(2, 1)
  })

  it('met le nord en haut du dessin', () => {
    const nord = g.cotes.find((c) => c.orientation === 'nord')!
    const sud = g.cotes.find((c) => c.orientation === 'sud')!
    expect(nord.a[1]).toBeLessThan(sud.a[1])
  })

  it('cote chaque mur à sa longueur, étiquette à l’extérieur', () => {
    expect(g.cotes.map((c) => Math.round(c.longueur)).sort((a, b) => a - b)).toEqual([6, 6, 12, 12])
    const nord = g.cotes.find((c) => c.orientation === 'nord')!
    expect(nord.etiquette[1]).toBeLessThan(nord.a[1]) // au-dessus du mur nord
    const est = g.cotes.find((c) => c.orientation === 'est')!
    expect(est.etiquette[0]).toBeGreaterThan(est.a[0]) // à droite du mur est
  })

  it('tient dans le dessin', () => {
    for (const p of g.contour) {
      expect(p[0]).toBeGreaterThanOrEqual(0)
      expect(p[0]).toBeLessThanOrEqual(g.largeur)
      expect(p[1]).toBeGreaterThanOrEqual(0)
      expect(p[1]).toBeLessThanOrEqual(g.hauteur)
    }
  })

  it('refuse un contour dégénéré', () => {
    expect(geometrieCroquis([m(0, 0), m(1, 0)])).toBeNull()
  })
})
