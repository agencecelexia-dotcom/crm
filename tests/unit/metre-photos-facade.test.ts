import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { depuisLambert93, versLambert93 } from '../../supabase/functions/_calcul-toit'
import { consigne, SCHEMA_LECTURE, tirerOuvertures, type LectureVision } from '../../supabase/functions/_ouvertures'
import { photoMapillary, photoPanoramax, type PhotoRue } from '../../supabase/functions/_photos-rue'
import { vuesDuMur, type MurVu } from '../../supabase/functions/_vue-facade'

// Les photos de façade : lire les photos de rue, choisir celle qui montre un
// mur, et tirer d'une lecture la surface des ouvertures.

const lire = (chemin: string) => JSON.parse(readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8'))

describe('photos de rue', () => {
  it('lit une recherche Panoramax (Nogent-sur-Marne, mars 2026)', () => {
    const j = lire('../fixtures/photos/panoramax-nogent.json') as { features: unknown[] }
    const photos = j.features.map((f) => photoPanoramax(f as never)).filter(Boolean) as PhotoRue[]
    expect(photos.length).toBeGreaterThan(10)
    for (const p of photos) {
      expect(p.source).toBe('panoramax')
      expect(p.url).toMatch(/^https:\/\//)
      expect(p.licence).toBe('CC-BY-SA-4.0')
      expect(p.largeur).toBe(2048)
      expect(p.champ).toBeGreaterThan(0)
    }
  })
  it('lit une image Mapillary, panoramique ou non', () => {
    const p = photoMapillary({
      id: '42',
      computed_geometry: { coordinates: [2.47, 48.83] },
      computed_compass_angle: 12,
      camera_type: 'spherical',
      width: 5760,
      height: 2880,
      thumb_2048_url: 'https://example.org/a.jpg',
      creator: { username: 'x' },
    })!
    expect(p.champ).toBe(360)
    expect([p.largeur, p.hauteur]).toEqual([2048, 1024])
    const q = photoMapillary({ id: '43', geometry: { coordinates: [2.47, 48.83] }, camera_type: 'perspective', camera_parameters: [0.8], width: 4000, height: 3000, thumb_2048_url: 'https://example.org/b.jpg' })!
    // Focale 0,8 du plus grand côté : champ horizontal de 2·atan(1/1,6) ≈ 64°.
    expect(q.champ).toBeCloseTo(64, 0)
  })
})

describe('quelle photo montre le mur', () => {
  // Un mur sud de 10 m, face au sud (azimut 180), centré sur O.
  const O = versLambert93(2.4785, 48.834)
  const ll = (dx: number, dy: number) => depuisLambert93(O[0] + dx, O[1] + dy) as [number, number]
  const mur: MurVu = { orientation: 'sud', azimut: 180, longueur: 10, a: ll(5, 0), b: ll(-5, 0), surface: 60 }
  const photo = (dx: number, dy: number, cap: number | null, champ = 65): PhotoRue => {
    const [lon, lat] = ll(dx, dy)
    return { source: 'panoramax', id: `${dx},${dy},${cap}`, lon, lat, cap, champ, largeur: 2048, hauteur: 1536, date: '2026-03-29', auteur: 'a', licence: 'CC-BY-SA-4.0', url: 'u', page: null }
  }

  it('garde la photo prise en face, le mur au milieu', () => {
    const [v] = vuesDuMur(mur, [photo(0, -15, 0)], [])
    expect(v).toBeDefined()
    expect(v.incidence).toBe(0)
    expect(v.dansLeChamp).toBe(1)
    expect(v.colonnes[0]).toBeLessThan(500)
    expect(v.colonnes[1]).toBeGreaterThan(500)
  })
  it('écarte la photo prise derrière le mur, ou qui regarde ailleurs', () => {
    expect(vuesDuMur(mur, [photo(0, 15, 180)], [])).toHaveLength(0)
    expect(vuesDuMur(mur, [photo(0, -15, 180)], [])).toHaveLength(0)
    // Cap inconnu, champ étroit : on ne sait pas où elle regarde.
    expect(vuesDuMur(mur, [photo(0, -15, null)], [])).toHaveLength(0)
  })
  it('garde une photo panoramique, quel que soit son cap', () => {
    const [v] = vuesDuMur(mur, [photo(3, -12, 90, 360)], [])
    expect(v).toBeDefined()
  })
  it('écarte une photo dont la vue est barrée par une autre maison', () => {
    const maison: [number, number][] = [ll(-8, -6), ll(8, -6), ll(8, -3), ll(-8, -3)]
    expect(vuesDuMur(mur, [photo(0, -15, 0)], [maison])).toHaveLength(0)
  })
  it('préfère la vue de face à la vue de biais', () => {
    const vues = vuesDuMur(mur, [photo(12, -8, -56), photo(0, -12, 0)], [])
    expect(vues[0].incidence).toBeLessThan(vues[1].incidence)
  })
})

describe('les ouvertures lues sur la photo', () => {
  const vision = (o: Partial<LectureVision> = {}): LectureVision => ({
    facade_visible: true,
    meme_maison: 'oui',
    cadre: { gauche: 100, haut: 200, droite: 900, bas: 800 },
    ligne_sol: 800,
    ligne_gouttiere: 300,
    mur_entier: true,
    part_cachee: 0,
    niveaux: 2,
    ouvertures: [
      { type: 'fenetre', gauche: 200, haut: 400, droite: 300, bas: 500 },
      { type: 'fenetre', gauche: 600, haut: 400, droite: 700, bas: 500 },
      { type: 'porte', gauche: 450, haut: 600, droite: 550, bas: 800 },
    ],
    materiau: 'enduit',
    remarque: '',
    ...o,
  })

  it('mesure chaque ouverture à l’échelle du mur relevé', () => {
    // Mur sous la gouttière : 800 × 500 pour 60 m² ; fenêtres 10 000 (1,5 m²), porte 20 000 (3 m²).
    const r = tirerOuvertures(vision(), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, 0)
    expect(r.nombre).toBe(3)
    expect(r.parType).toEqual({ fenetre: 2, porte: 1 })
    expect(r.methode).toBe('mesure')
    expect(r.surface).toBe(6)
    expect(r.utilisable).toBe(true)
  })
  it('borne une ouverture à une taille plausible', () => {
    // Une « fenêtre » de 15 m² est une boîte trop large : ramenée à 3,5 m².
    const r = tirerOuvertures(
      vision({ ouvertures: [{ type: 'fenetre', gauche: 100, haut: 300, droite: 500, bas: 800 }] }),
      { longueur: 10, hauteurGouttiere: 6 },
      4 / 3,
      0,
    )
    expect(r.surface).toBe(3.5)
  })
  it('compte à la surface type sur une photo lointaine', () => {
    // Façade de 86/1000 d'une image de 2 048 px : 176 px, trop peu pour mesurer.
    const r = tirerOuvertures(
      vision({ cadre: { gauche: 304, haut: 352, droite: 390, bas: 560 }, ligne_sol: 556, ligne_gouttiere: 382 }),
      { longueur: 7.1, hauteurGouttiere: 6.6 },
      2,
      11,
      'rue',
      2048,
    )
    expect(r.methode).toBe('forfait')
    expect(r.surface).toBe(1.5 + 1.5 + 2)
  })
  it('donne une hauteur de contrôle de face, mur entier', () => {
    // 500 de haut pour 800 de large, image 4:3 : 500 / (800 × 4/3) × 10 m ≈ 4,7 m.
    expect(tirerOuvertures(vision(), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, 0).hauteurPhoto).toBe(4.7)
    expect(tirerOuvertures(vision(), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, 45).hauteurPhoto).toBeNull()
  })
  it('refuse une autre maison, et signale une façade coupée', () => {
    expect(tirerOuvertures(vision({ meme_maison: 'non' }), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, 0)).toMatchObject({ utilisable: false, motif: 'autre_batiment', surface: null })
    expect(tirerOuvertures(vision({ mur_entier: false }), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, 0)).toMatchObject({ utilisable: false, motif: 'facade_partielle' })
    // Photo de l'artisan : un doute ne suffit pas à l'écarter.
    expect(tirerOuvertures(vision({ meme_maison: 'douteux' }), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, null, 'artisan')).toMatchObject({ utilisable: true })
    expect(tirerOuvertures(vision({ meme_maison: 'douteux' }), { longueur: 10, hauteurGouttiere: 6 }, 4 / 3, 0, 'rue')).toMatchObject({ utilisable: false })
  })
  it('la consigne donne le mur relevé et où le chercher', () => {
    const t = consigne({ orientation: 'sud', origine: 'rue', longueur: 9.7, hauteurGouttiere: 6.2, type: 'gouttereau', colonnes: [310, 640], distance: 14 })
    expect(t).toContain('9.7 m')
    expect(t).toContain('vers les abscisses 310 à 640')
    expect(t).toContain('environ 2 niveaux')
    expect(SCHEMA_LECTURE.required).toContain('ouvertures')
  })
})
