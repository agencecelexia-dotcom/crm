import { describe, expect, it } from 'vitest'
import { longueurAccolee, murs, type Point } from '@/features/metre/geometrie'

// Un mètre vers l'est ou le nord, à la latitude de Strasbourg.
const LAT = 48.58
const m = (est: number, nord: number): Point => [7.75 + est / (111320 * Math.cos((LAT * Math.PI) / 180)), LAT + nord / 111320]
const rectangle = (x: number, y: number, l: number, h: number): Point[] => [m(x, y), m(x + l, y), m(x + l, y + h), m(x, y + h)]

const maison = rectangle(0, 0, 10, 8)
const murDe = (orientation: string) => murs(maison).find((w) => w.orientation === orientation)!

describe('longueurAccolee', () => {
  it('une maison isolée n’a aucun mur accolé', () => {
    const voisin = rectangle(14, 0, 10, 8) // quatre mètres plus loin
    for (const w of murs(maison)) expect(longueurAccolee(w, [voisin])).toBe(0)
  })

  it('une maison mitoyenne partage tout son mur', () => {
    const voisine = rectangle(10, 0, 10, 8) // collée à l'est
    expect(longueurAccolee(murDe('est'), [voisine])).toBeCloseTo(8, 0)
    expect(longueurAccolee(murDe('ouest'), [voisine])).toBe(0)
  })

  it('un garage accolé sur la moitié du mur n’en prend que la moitié', () => {
    const garage = rectangle(10, 0, 5, 4)
    expect(longueurAccolee(murDe('est'), [garage])).toBeCloseTo(4, 0)
  })

  it('tolère un décalage de numérisation, pas une ruelle', () => {
    expect(longueurAccolee(murDe('est'), [rectangle(10.4, 0, 10, 8)])).toBeCloseTo(8, 0)
    expect(longueurAccolee(murDe('est'), [rectangle(11.5, 0, 10, 8)])).toBe(0)
  })

  it('un voisin qui ne touche qu’un coin ne rend pas le mur accolé', () => {
    const coin = rectangle(10, 8, 6, 6) // touche l'angle nord-est seulement
    expect(longueurAccolee(murDe('est'), [coin])).toBeLessThan(1)
  })
})
