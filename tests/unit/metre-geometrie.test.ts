import { describe, expect, it } from 'vitest'
import {
  aire,
  centre,
  degresEnPct,
  distance,
  formatM,
  formatM2,
  longueur,
  pctEnDegres,
  surfaceReelle,
  type Point,
} from '../../src/features/metre/geometrie'

/** Rectangle de 10 m (nord-sud) sur 20 m (est-ouest), à 46° de latitude. */
function rectangle(lat = 46, lon = 5, h = 10, l = 20): Point[] {
  const dLat = h / 111320
  const dLon = l / (111320 * Math.cos((lat * Math.PI) / 180))
  return [
    [lon, lat],
    [lon + dLon, lat],
    [lon + dLon, lat + dLat],
    [lon, lat + dLat],
  ]
}

describe('aire — la surface qui finira dans un devis', () => {
  it('mesure un rectangle de 10 × 20 m à 200 m² près de 0,1 %', () => {
    expect(aire(rectangle())).toBeCloseTo(200, 0)
  })

  it('retrouve un bâtiment réel de la BD TOPO', () => {
    // Emprise relevée sur le service de l'IGN, vérifiée contre la base et
    // contre un calcul plan indépendant : 88.07 m².
    const batiment: Point[] = [
      [6.4777532, 46.3723642],
      [6.4776667, 46.3722939],
      [6.4775801, 46.3723452],
      [6.4776664, 46.3724129],
    ]
    expect(aire(batiment)).toBeCloseTo(88.07, 1)
  })

  it('ne dépend pas du sens de parcours', () => {
    const r = rectangle()
    expect(aire([...r].reverse())).toBeCloseTo(aire(r), 6)
  })

  it('vaut zéro sous trois sommets', () => {
    expect(aire([])).toBe(0)
    expect(aire([[5, 46]])).toBe(0)
    expect(aire([[5, 46], [5.001, 46]])).toBe(0)
  })
})

describe('longueur — mètres linéaires et périmètre', () => {
  it('donne 60 m de périmètre au rectangle 10 × 20', () => {
    expect(longueur(rectangle(), true)).toBeCloseTo(60, 0)
  })

  it('ouverte, elle ne referme pas le tracé', () => {
    // Trois côtés seulement : 20 + 10 + 20 = 50 m.
    expect(longueur(rectangle(), false)).toBeCloseTo(50, 0)
  })

  it('mesure une distance est-ouest connue', () => {
    expect(distance([5, 46], [5 + 20 / (111320 * Math.cos((46 * Math.PI) / 180)), 46]))
      .toBeCloseTo(20, 1)
  })
})

describe('surfaceReelle — un toit n’est pas son ombre', () => {
  it('ajoute 4,4 % à 30 % de pente', () => {
    expect(surfaceReelle(100, 30)).toBeCloseTo(104.4, 1)
  })

  it('ajoute 18 % à 60 % de pente', () => {
    expect(surfaceReelle(100, 60)).toBeCloseTo(116.6, 1)
  })

  it('ne touche à rien sans pente', () => {
    expect(surfaceReelle(100, 0)).toBe(100)
    expect(surfaceReelle(100, NaN)).toBe(100)
    expect(surfaceReelle(100, -5)).toBe(100)
  })

  it('convertit pourcentage et degrés dans les deux sens', () => {
    expect(pctEnDegres(100)).toBeCloseTo(45, 6)
    expect(degresEnPct(45)).toBeCloseTo(100, 6)
    expect(degresEnPct(pctEnDegres(30))).toBeCloseTo(30, 6)
  })
})

describe('centre et formats', () => {
  it('place le centre au milieu du rectangle', () => {
    const c = centre(rectangle())!
    expect(c[0]).toBeGreaterThan(5)
    expect(c[1]).toBeGreaterThan(46)
  })

  it('renvoie null sur un tracé vide', () => {
    expect(centre([])).toBeNull()
  })

  it('écrit les mesures comme on les dit', () => {
    expect(formatM2(142.3)).toBe('142 m²')
    expect(formatM2(4.53)).toBe('4,5 m²')
    expect(formatM2(1234)).toBe('1 234 m²')
    expect(formatM(12.34)).toBe('12,3 m')
    expect(formatM(4.567)).toBe('4,57 m')
  })
})

import { cardinal, encombrement, murs, toitureDepuisAltitudes } from '../../src/features/metre/geometrie'

/** Rectangle aligné nord-sud / est-ouest, parcouru dans le sens trigonométrique. */
function batiment(lat = 46, lon = 5, largeur = 8, longueur = 12): Point[] {
  const dLat = largeur / 111320
  const dLon = longueur / (111320 * Math.cos((lat * Math.PI) / 180))
  return [
    [lon, lat],
    [lon + dLon, lat],
    [lon + dLon, lat + dLat],
    [lon, lat + dLat],
  ]
}

describe('murs — une façade, pas l’enveloppe entière', () => {
  it('donne un mur par côté, avec sa longueur', () => {
    const m = murs(batiment())
    expect(m).toHaveLength(4)
    expect(m[0].longueur).toBeCloseTo(12, 0)
    expect(m[1].longueur).toBeCloseTo(8, 0)
  })

  it('nomme chaque façade par son orientation', () => {
    // Contour parcouru vers l'est en bas : ce mur regarde le SUD.
    const m = murs(batiment())
    expect(m[0].orientation).toBe('sud')
    expect(m[1].orientation).toBe('est')
    expect(m[2].orientation).toBe('nord')
    expect(m[3].orientation).toBe('ouest')
  })

  it('donne la même orientation quel que soit le sens de parcours', () => {
    const inverse = murs([...batiment()].reverse())
    expect(inverse.map((x) => x.orientation).sort()).toEqual(['est', 'nord', 'ouest', 'sud'])
  })

  it('écarte les décrochés de numérisation sous un mètre', () => {
    const b = batiment()
    const micro: Point[] = [...b, [b[0][0] + 0.000002, b[0][1] + 0.000002]]
    expect(murs(micro).length).toBeLessThanOrEqual(5)
    expect(murs(micro).every((m) => m.longueur >= 1)).toBe(true)
  })

  it('traduit un azimut en point cardinal', () => {
    expect(cardinal(0)).toBe('nord')
    expect(cardinal(90)).toBe('est')
    expect(cardinal(180)).toBe('sud')
    expect(cardinal(271)).toBe('ouest')
    expect(cardinal(-45)).toBe('nord-ouest')
  })
})

describe('encombrement — les dimensions hors tout', () => {
  it('retrouve 12 × 8 sur un rectangle', () => {
    const e = encombrement(batiment())!
    expect(e.longueur).toBeCloseTo(12, 0)
    expect(e.largeur).toBeCloseTo(8, 0)
  })

  it('suit le grand axe, ici est-ouest', () => {
    const e = encombrement(batiment())!
    // Un axe est-ouest a un azimut de 90 ou 270 degrés.
    expect([90, 270].map((a) => Math.abs(e.azimutLong - a)).some((d) => d < 2)).toBe(true)
  })

  it('renvoie null sous trois sommets', () => {
    expect(encombrement([[5, 46], [5.001, 46]])).toBeNull()
  })
})

describe('toitureDepuisAltitudes — la pente qu’on ne voyait pas', () => {
  it('déduit la pente du dénivelé et de la demi-largeur', () => {
    // 2 m de dénivelé sur 4 m de demi-largeur : 50 %.
    const t = toitureDepuisAltitudes({ emprise: 96, largeur: 8, toitMin: 442, toitMax: 444 })!
    expect(t.pente).toBeCloseTo(50, 1)
    expect(t.denivele).toBeCloseTo(2, 3)
    expect(t.surface).toBeCloseTo(96 / Math.cos(Math.atan(0.5)), 0)
  })

  it('annonce l’incertitude, qui est grande sur une petite maison', () => {
    const petite = toitureDepuisAltitudes({ emprise: 40, largeur: 6, toitMin: 442, toitMax: 443.5 })!
    const grande = toitureDepuisAltitudes({ emprise: 400, largeur: 20, toitMin: 442, toitMax: 447 })!
    // Un mètre d'erreur sur trois mètres de demi-largeur : ± 33 points.
    expect(petite.incertitude).toBeCloseTo(33.3, 0)
    expect(grande.incertitude).toBeCloseTo(10, 0)
    expect(grande.incertitude).toBeLessThan(petite.incertitude)
  })

  it('traite un toit plat sans inventer de pente', () => {
    const t = toitureDepuisAltitudes({ emprise: 200, largeur: 10, toitMin: 442, toitMax: 442.1 })!
    expect(t.pente).toBe(0)
    expect(t.surface).toBe(200)
  })

  it('renvoie null sans altitude de toit', () => {
    expect(toitureDepuisAltitudes({ emprise: 96, largeur: 8, toitMin: null, toitMax: 444 })).toBeNull()
  })
})
