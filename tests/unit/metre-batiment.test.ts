import { describe, expect, it } from 'vitest'
import { DISTANCE_SURE_M, jugerLien, lienDeLAdresse, type BatimentBd } from '../../supabase/functions/_batiment'

// Le lien entre un point d'adresse et sa maison : prouvé, ou à confirmer.
// Les distances sont celles de l'audit du 29/09/2026 (point BAN → bâtiment).

describe('jugerLien : ce qui prouve que la maison est celle du numéro', () => {
  it('le point sur la maison prouve le lien', () => {
    expect(jugerLien({ methode: 'rnb', distance: 0, parcelle: 'inconnue' })).toMatchObject({ confiance: 'officielle', preuve: 'dans' })
    expect(jugerLien({ methode: 'contenant', distance: 0, parcelle: 'inconnue' })).toMatchObject({ confiance: 'officielle', preuve: 'dans' })
  })

  it('un lien RNB à moins de 5 m suffit', () => {
    expect(jugerLien({ methode: 'rnb', distance: DISTANCE_SURE_M, parcelle: 'inconnue' })).toMatchObject({ confiance: 'officielle', preuve: 'proche' })
  })

  it('la maison seule sur la parcelle du numéro prouve le lien, même à 12,7 m (Nogent 27 bis)', () => {
    expect(jugerLien({ methode: 'rnb', distance: 12.7, parcelle: 'seule' })).toMatchObject({
      confiance: 'officielle',
      preuve: 'parcelle',
      distance_m: 12.7,
    })
  })

  it('sans preuve, à 9,4 m (Sathonay), 14,1 m (Oucques) ou 16,3 m (Oullins) : à confirmer, distance dite', () => {
    for (const d of [9.4, 14.1, 16.3]) {
      const l = jugerLien({ methode: 'rnb', distance: d, parcelle: 'inconnue' })
      expect(l.confiance).toBe('a_confirmer')
      expect(l.doute).toContain(`${d} m`)
    }
  })

  it('à 21,6 m et sur une autre parcelle (Oucques 1b) : à confirmer, et on le dit', () => {
    const l = jugerLien({ methode: 'rnb', distance: 21.6, parcelle: 'autre' })
    expect(l.confiance).toBe('a_confirmer')
    expect(l.doute).toContain('autre parcelle')
  })

  it('plusieurs bâtiments sur la parcelle : à confirmer', () => {
    const l = jugerLien({ methode: 'rnb', distance: 8, parcelle: 'partagee' })
    expect(l.confiance).toBe('a_confirmer')
    expect(l.doute).toContain('Plusieurs bâtiments')
  })

  it('la maison la plus proche, sans lien officiel, ne s’impose jamais', () => {
    expect(jugerLien({ methode: 'proximite', distance: 3, parcelle: 'seule' }).confiance).toBe('a_confirmer')
    expect(jugerLien({ methode: 'proximite', distance: 0, parcelle: 'seule' }).confiance).toBe('a_confirmer')
  })
})

describe('lienDeLAdresse : sans réseau quand la distance suffit', () => {
  // Un carré de 10 m de côté autour de (2,4 ; 48,8).
  const dLat = 5 / 111320, dLon = 5 / (111320 * Math.cos((48.8 * Math.PI) / 180))
  const maison = {
    cleabs: 'BATIMENT0000000000000001',
    contour: [
      [2.4 - dLon, 48.8 - dLat],
      [2.4 + dLon, 48.8 - dLat],
      [2.4 + dLon, 48.8 + dLat],
      [2.4 - dLon, 48.8 + dLat],
    ] as [number, number][],
    aire: 100,
    usage: 'Résidentiel',
    hauteur: 6,
  } as unknown as BatimentBd

  it('un point dans la maison', async () => {
    expect(await lienDeLAdresse([2.4, 48.8], { methode: 'rnb', principal: maison })).toMatchObject({ confiance: 'officielle', preuve: 'dans', distance_m: 0 })
  })

  it('un point à 3 m du mur', async () => {
    const l = await lienDeLAdresse([2.4, 48.8 + dLat + 3 / 111320], { methode: 'rnb', principal: maison })
    expect(l).toMatchObject({ confiance: 'officielle', preuve: 'proche' })
    expect(l.distance_m).toBeGreaterThan(2.5)
    expect(l.distance_m).toBeLessThan(3.5)
  })
})
