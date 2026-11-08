import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculer, grilleIgn, hauteursToit, lireGeoTiff, mesurerToit } from '../../supabase/functions/_calcul-toit'
import { solLocal } from '../../supabase/functions/_nuage'
import { releverBatiment, type Releve } from '../../supabase/functions/_releve'
import { quantitesDeLaMaison, quantitesDesOuvertures, quantitesDuReleve } from '../../supabase/functions/_mesures-chantier'
import { orientationsDesFacades } from '../../supabase/functions/_releve-retenu'
import { tirerOuvertures, type LectureVision, type PhotoLue } from '../../supabase/functions/_ouvertures'
import { contourDe, deuxPans, nuageDe, type Scene } from './aide-nuage'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

// TIFF valide à deux strips séparés par du remplissage : lire les pixels
// consécutivement depuis le premier offset produit [1, 2, 0, 0] au lieu de 1..4.
function tiffDeuxStrips(pb = true): ArrayBuffer {
  const ab = new ArrayBuffer(240), d = new DataView(ab)
  d.setUint8(0, pb ? 73 : 77); d.setUint8(1, pb ? 73 : 77)
  d.setUint16(2, 42, pb); d.setUint32(4, 8, pb)
  const tags = [[256, 4, 1, 2], [257, 4, 1, 2], [258, 3, 1, 32], [259, 3, 1, 1], [273, 4, 2, 160], [277, 3, 1, 1], [278, 4, 1, 1], [279, 4, 2, 168], [339, 3, 1, 3]]
  d.setUint16(8, tags.length, pb)
  tags.forEach(([tag, type, n, val], i) => {
    const off = 10 + i * 12
    d.setUint16(off, tag, pb); d.setUint16(off + 2, type, pb); d.setUint32(off + 4, n, pb)
    if (type === 3) d.setUint16(off + 8, val, pb)
    else d.setUint32(off + 8, val, pb)
  })
  d.setUint32(160, 200, pb); d.setUint32(164, 224, pb)
  d.setUint32(168, 8, pb); d.setUint32(172, 8, pb)
  ;[1, 2, 3, 4].forEach((v, i) => d.setFloat32(i < 2 ? 200 + i * 4 : 224 + (i - 2) * 4, v, pb))
  return ab
}

describe('mesures : une altitude absolue n’est pas une hauteur', () => {
  const scene: Scene = { origine: [845000, 6525000], rotation: 0, demiCote: 9, volumes: [deuxPans({ l: 8, y0: -5, y1: 5, p: 0.7, d: 0.5, h: 5 })] }
  const contour = contourDe(scene, [-4, -5, 4, 5])

  it('refuse un relevé sans point classé sol au lieu de produire des murs de 205 m', () => {
    const { nuage, zone } = nuageDe(scene)
    nuage.classe = nuage.classe.map((c) => c === 2 ? 1 : c)
    expect(() => releverBatiment({ nuage, zone, contour, voisins: [], vol: null })).toThrow('sol_absent')
  })

  it('refuse aussi des points sol dont les altitudes ne sont pas finies', () => {
    const { nuage, zone } = nuageDe(scene)
    nuage.z = nuage.z.map((z, i) => nuage.classe[i] === 2 ? Infinity : z)
    expect(() => solLocal(nuage, zone)).toThrow('sol_absent')
  })

  it('conserve la hauteur connue quand le sol valide est à 200 m NGF', () => {
    const { nuage, zone } = nuageDe(scene)
    const r = releverBatiment({ nuage, zone, contour, voisins: [], vol: null })
    expect(r.hauteurs.gouttiere).toBeCloseTo(4.75, 0)
    expect(r.surfaces.toitVrai).toBeGreaterThan(110)
    expect(r.confiance).toBe('haute')
  })
})

describe('mesures : couverture et provenance des photos', () => {
  const r = JSON.parse(readFileSync(new URL('../fixtures/copc/deux-pans-simple/releve.json', import.meta.url), 'utf8')) as Releve
  const vision: LectureVision = { facade_visible: true, meme_maison: 'oui', cadre: { gauche: 100, haut: 200, droite: 900, bas: 800 }, ligne_sol: 800, ligne_gouttiere: 300, mur_entier: true, part_cachee: 0, niveaux: 1, ouvertures: [{ type: 'fenetre', gauche: 200, haut: 400, droite: 300, bas: 500 }], materiau: 'enduit', remarque: '' }
  const mur = { longueur: 10, hauteurGouttiere: 6, surfaceLibre: 60 }
  const photos: PhotoLue[] = orientationsDesFacades(r).map((orientation, i) => ({ id: `fictive-${i}`, orientation, source: 'artisan', largeur: 2048, hauteur: 1536, incidence: null, lecture: { vision, resultat: tirerOuvertures(vision, mur, 4 / 3, null, 'artisan'), mur } }))

  it('ne transforme pas une seule façade lue en total de toutes les ouvertures', () => {
    expect(quantitesDesOuvertures(r, photos.slice(0, 1))).toEqual([])
  })

  it('compte toutes les façades et déclare la contribution IA à la surface nette', () => {
    const q = quantitesDesOuvertures(r, photos)
    expect(q.find((x) => x.cle === 'ouvertures')?.valeur).toBe(photos.length)
    expect(q.find((x) => x.cle === 'facade_nette')?.source).toBe('ia_photo')
  })

  it('ne présente pas une hypothèse de déplacement du bord comme précision garantie', () => {
    const q = quantitesDuReleve(r).find((x) => x.cle === 'toit_surface')!
    expect(q.precision).toBeNull()
    expect(q.detail?.hypothese_bord_cm).toBe(5)
  })
})

it('le calcul raster ne rajoute pas un débord de toit qui n’a pas été mesuré', () => {
  const contour = contourDe({ origine: [845000, 6525000], rotation: 0 }, [0, 0, 10, 10])
  const q = quantitesDeLaMaison(contour, { ok: true, couvert: true, fiable: true, motif: null, pente: 0, incertitude: 0, pixels: 100, versants: [], source: 'LiDAR HD IGN', mesure_le: '2026-11-08', murs: null, hauteur_gouttiere: null, hauteur_faitage: null, facteur: 1, part_plate: 1, pans: [] })
  const toit = q.find((x) => x.cle === 'toit_surface')!
  // Le calcul planaire de l'écran utilise une approximation locale (<1%).
  expect(toit.valeur).toBeGreaterThan(99)
  expect(toit.valeur).toBeLessThan(101)
  expect(toit.detail).toMatchObject({ debord_m: 0, hors_debord: true })
})

describe('grilles IGN : intégrité avant calcul', () => {
  it.each([true, false])('lit chaque strip à son propre offset (little endian = %s)', (pb) => {
    expect([...lireGeoTiff(tiffDeuxStrips(pb)).px]).toEqual([1, 2, 3, 4])
  })

  it('refuse un TIFF tronqué avec une erreur explicite', () => {
    expect(() => lireGeoTiff(tiffDeuxStrips().slice(0, 227))).toThrow('tiff_incomplet')
  })

  it('refuse une grille qui ne correspond pas aux dimensions géographiques demandées', async () => {
    const contour = contourDe({ origine: [845000, 6525000], rotation: 0 }, [-5, -5, 5, 5])
    await expect(mesurerToit(contour, async () => tiffDeuxStrips())).rejects.toThrow('grille_dimensions')
  })

  it('refuse les coordonnées non finies avant tout appel fournisseur', async () => {
    const lire = vi.fn(async () => tiffDeuxStrips())
    await expect(mesurerToit([[NaN, 48], [2, 48], [2, 48.1]], lire)).rejects.toThrow('contour_invalide')
    expect(lire).not.toHaveBeenCalled()
  })

  it('ne calcule ni pente ni hauteur à partir de valeurs infinies', () => {
    const surface = { w: 8, h: 8, px: new Float32Array(64).fill(Infinity) }
    const poly: [number, number][] = [[0, 0], [8, 0], [8, 8], [0, 8]]
    expect(calculer(surface, new Float32Array(64).fill(5), poly, 0, 0, 1, 25)).toBeNull()
    expect(hauteursToit(surface, poly, 0, 0, 1)).toBeNull()
  })

  it('garde le délai de garde actif pendant le téléchargement du corps', async () => {
    vi.useFakeTimers()
    const fetchFictif = vi.fn(async (_url: string, opts: RequestInit) => ({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => opts.signal!.addEventListener('abort', () => reject(new Error('corps_interrompu')), { once: true })) }))
    vi.stubGlobal('fetch', fetchFictif)
    const resultat = grilleIgn('fictive', 0, 0, 1, 1, 2, 2).then(() => 'termine', (e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(70_000)
    expect(await Promise.race([resultat, Promise.resolve('encore_en_attente')])).toBe('corps_interrompu')
    expect(fetchFictif).toHaveBeenCalledTimes(3)
  })
})
