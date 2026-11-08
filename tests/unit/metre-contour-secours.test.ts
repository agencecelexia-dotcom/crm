import { describe, expect, it } from 'vitest'
import { batimentDuContour, memeBatiment } from '../../src/features/metre/bati-ign'
import { corsMetre } from '../../supabase/functions/_cors-metre'

describe('contour du serveur en secours du WFS navigateur', () => {
  const contour: [number, number][] = [[6.4777532, 46.3723642], [6.4776667, 46.3722939], [6.4775801, 46.3723452], [6.4776664, 46.3724129]]
  it('conserve 88,07 m² vérifiés sans inventer la hauteur ou la pente absentes', () => {
    const b = batimentDuContour('BATIMENT0000000000000001', contour)!
    expect(b.emprise).toBeCloseTo(88.07, 1)
    expect(b.hauteur).toBeNull()
    expect(b.toiture).toBeNull()
    expect(b.facades.length).toBeGreaterThan(0)
  })
  it('refuse un contour invalide entier plutôt que supprimer un sommet et changer sa surface', () => {
    expect(batimentDuContour('invalide', [...contour, [NaN, 45]])).toBeNull()
    expect(batimentDuContour('invalide', contour.slice(0, 2))).toBeNull()
  })
  it('ne prend pas son propre contour enrichi pour un voisin mitoyen après réessai du WFS', () => {
    const secours = batimentDuContour('BATIMENT0000000000000001', contour)!
    const enrichi = { ...secours, id: 'batiment.123456', hauteur: 6 }
    expect(memeBatiment(secours, enrichi)).toBe(true)
    expect(memeBatiment(secours, { ...enrichi, cleabs: 'BATIMENT0000000000000002' })).toBe(false)
  })
  it('accepte les ports locaux utilisés pour les métrés sans accepter un domaine ressemblant', () => {
    expect(corsMetre('http://localhost:5174')['Access-Control-Allow-Origin']).toBe('http://localhost:5174')
    expect(corsMetre('http://127.0.0.1:5180')['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:5180')
    expect(corsMetre('http://localhost.exemple.fr:5174')['Access-Control-Allow-Origin']).not.toBe('http://localhost.exemple.fr:5174')
  })
})
