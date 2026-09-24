import { describe, expect, it } from 'vitest'
import {
  partsNormalisees,
  penteRetenue,
  versantsLisibles,
  type Toiture,
} from '@/features/metre/use-toiture'

const mesure = (p: Partial<Toiture>): Toiture => ({
  ok: true,
  couvert: true,
  fiable: true,
  pente: 61,
  incertitude: 3,
  source: 'LiDAR HD de l’IGN, grille de 50 cm',
  ...p,
})

describe('penteRetenue — quel chiffre l’artisan recopie', () => {
  it('l’artisan passe avant la mesure : il est sur place', () => {
    expect(penteRetenue({ saisie: 40, mesuree: mesure({}), deduite: 55 })).toEqual({
      pente: 40,
      source: 'saisie',
    })
  })

  it('la mesure passe avant la déduction', () => {
    expect(penteRetenue({ saisie: null, mesuree: mesure({}), deduite: 55 })).toEqual({
      pente: 61,
      source: 'lidar',
    })
  })

  // C'EST L'INVARIANT QUI COMPTE. Un toit d'îlot urbain donne une médiane de
  // 65 % avec ±65 d'incertitude : du bruit. Le servir comme une mesure serait
  // exactement le défaut que l'audit a reproché à la version précédente.
  it('une mesure NON FIABLE ne devient jamais la pente affichée', () => {
    const bruit = mesure({ fiable: false, pente: 65, incertitude: 65 })
    expect(penteRetenue({ saisie: null, mesuree: bruit, deduite: 35 })).toEqual({
      pente: 35,
      source: 'altitudes',
    })
    expect(penteRetenue({ saisie: null, mesuree: bruit, deduite: null })).toEqual({
      pente: 0,
      source: null,
    })
  })

  it('hors couverture, on retombe sur la déduction', () => {
    const absent = mesure({ couvert: false, fiable: false, pente: null })
    expect(penteRetenue({ saisie: null, mesuree: absent, deduite: 35 }).source).toBe('altitudes')
  })

  it('la photogrammétrie est nommée pour ce qu’elle est', () => {
    const photo = mesure({ source: 'Photogrammétrie de l’IGN, grille de 1 m', pente: 53 })
    expect(penteRetenue({ saisie: null, mesuree: photo, deduite: null })).toEqual({
      pente: 53,
      source: 'photogrammetrie',
    })
  })

  it('sans rien du tout, la pente vaut zéro et n’a pas de source', () => {
    expect(penteRetenue({ saisie: null, mesuree: null, deduite: null })).toEqual({
      pente: 0,
      source: null,
    })
  })

  // Une pente saisie à zéro est un toit PLAT, pas une absence de réponse.
  it('zéro saisi est un toit plat, pas une absence', () => {
    expect(penteRetenue({ saisie: 0, mesuree: mesure({}), deduite: 55 })).toEqual({
      pente: 0,
      source: 'saisie',
    })
  })
})

describe('versantsLisibles', () => {
  it('nomme les deux versants principaux', () => {
    expect(
      versantsLisibles([
        { orientation: 'nord-est', part: 0.48 },
        { orientation: 'sud-ouest', part: 0.39 },
        { orientation: 'est', part: 0.13 },
      ]),
    ).toBe('nord-est et sud-ouest')
  })

  it('un seul versant se dit seul', () => {
    expect(versantsLisibles([{ orientation: 'nord', part: 0.9 }])).toBe('nord')
  })

  it('sans versant, rien à dire', () => {
    expect(versantsLisibles([])).toBeNull()
    expect(versantsLisibles(undefined)).toBeNull()
  })
})

describe('partsNormalisees — les versants qu’on ose proposer', () => {
  const trois = [
    { orientation: 'nord-est', part: 0.46 },
    { orientation: 'sud-ouest', part: 0.4 },
    { orientation: 'nord-ouest', part: 0.14 },
  ]

  // Les parts renvoyées sont celles des pixels EN PENTE, et les versants sous
  // dix pour cent sont écartés : elles ne somment pas à un.
  it('renormalise sur ce qui a été retenu', () => {
    const p = partsNormalisees(mesure({ versants: [
      { orientation: 'nord', part: 0.53 },
      { orientation: 'sud', part: 0.3 },
    ] }))
    expect(p.map((x) => x.orientation)).toEqual(['nord', 'sud'])
    expect(p[0].part + p[1].part).toBeCloseTo(1, 10)
    // 0,53 sur un total de 0,83 fait les deux tiers du toit, pas la moitié.
    expect(p[0].part).toBeCloseTo(0.53 / 0.83, 10)
  })

  // C'EST L'INCOHÉRENCE À NE PAS LAISSER PASSER : l'écran ne peut pas dire que
  // le toit est trop découpé pour avoir une pente, puis chiffrer ses versants
  // à partir de cette même pente.
  it('ne propose aucun versant quand la mesure n’est pas fiable', () => {
    expect(partsNormalisees(mesure({ fiable: false, versants: trois }))).toEqual([])
  })

  it('ne propose aucun versant hors couverture', () => {
    expect(partsNormalisees(mesure({ couvert: false, versants: trois }))).toEqual([])
  })

  it('sans mesure du tout, rien', () => {
    expect(partsNormalisees(null)).toEqual([])
    expect(partsNormalisees(undefined)).toEqual([])
    expect(partsNormalisees(mesure({ versants: [] }))).toEqual([])
  })
})
