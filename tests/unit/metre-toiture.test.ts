import { describe, expect, it } from 'vitest'
import { facades, type Point } from '@/features/metre/geometrie'
import {
  mesureFacade,
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

describe('mesureFacade — la hauteur mesurée mur par mur', () => {
  // Un rectangle de 20 m (est-ouest) sur 10 m (nord-sud), sens trigonométrique.
  const lat = 46, lon = 5
  const dLat = 10 / 111320
  const dLon = 20 / (111320 * Math.cos((lat * Math.PI) / 180))
  const contour: Point[] = [
    [lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat],
  ]
  const fac = facades(contour)
  const releve = (surfaces: number[], valide = 1): Toiture =>
    mesure({
      murs: surfaces.map((s, i) => ({
        i, longueur: i % 2 ? 10 : 20, surface: s, hauteur_moyenne: s / (i % 2 ? 10 : 20),
        hauteur_min: 5, hauteur_max: 6, valide, accole: false,
      })),
    })

  // Arête 0 : sud (20 m), 1 : est (10 m), 2 : nord (20 m), 3 : ouest (10 m).
  it('rattache chaque façade à sa propre arête', () => {
    const t = releve([120, 80, 110, 55])
    const sud = fac.find((f) => f.orientation === 'sud')!
    const est = fac.find((f) => f.orientation === 'est')!
    expect(sud.pans.flatMap((p) => p.aretes)).toEqual([0])
    expect(mesureFacade(sud, t)!.surface).toBe(120)
    expect(mesureFacade(est, t)!.surface).toBe(80)
    expect(mesureFacade(est, t)!.hauteurMoyenne).toBeCloseTo(8, 6)
  })

  it('refuse un relevé trouvé sur moins de 80 % du mur', () => {
    const sud = fac.find((f) => f.orientation === 'sud')!
    expect(mesureFacade(sud, releve([120, 80, 110, 55], 0.6))).toBeNull()
  })

  it('refuse plutôt que de compléter quand une arête manque', () => {
    const sud = fac.find((f) => f.orientation === 'sud')!
    const t = mesure({ murs: [] })
    expect(mesureFacade(sud, t)).toBeNull()
    const sansSud = releve([120, 80, 110, 55])
    sansSud.murs = sansSud.murs!.filter((m) => m.i !== 0)
    expect(mesureFacade(sud, sansSud)).toBeNull()
  })

  it('sans relevé LiDAR, rien', () => {
    expect(mesureFacade(fac[0], null)).toBeNull()
  })
})
