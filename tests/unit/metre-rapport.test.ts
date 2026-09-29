import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { materiauDeBdnb, cadreDuToit, SCHEMA_TOIT } from '../../supabase/functions/_materiaux'
import { quantitesDesOuvertures, quantitesDuReleve, quantitesDuToitLu } from '../../supabase/functions/_mesures-chantier'
import { photoDeLaFacade, resultatRetenu, tirerOuvertures, type LectureVision, type PhotoLue } from '../../supabase/functions/_ouvertures'
import { facadeRetenue, orientationsDesFacades } from '../../supabase/functions/_releve-retenu'
import type { Releve } from '../../supabase/functions/_releve'
import { csvDuRapport, rapportMetre, type PhotoDuRapport } from '../../src/features/metre/rapport-metre'

// Le rapport et le dossier disent les mêmes chiffres ; une ouverture retirée
// par l'artisan sort des deux.

const DOSSIER = fileURLToPath(new URL('../fixtures/copc', import.meta.url))
const lire = (nom: string) => JSON.parse(readFileSync(join(DOSSIER, nom, 'releve.json'), 'utf8')) as Releve

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
  materiau: 'enduit gratté',
  remarque: '',
  ...o,
})

/** Une photo lue pour chaque façade à traiter du relevé. */
function photosDe(r: Releve, source: PhotoLue['source'] = 'artisan'): PhotoDuRapport[] {
  return orientationsDesFacades(r)
    .filter((o) => facadeRetenue(r, o).surface > 0)
    .map((o, i) => {
      const mur = { longueur: 10, hauteurGouttiere: 6, surfaceLibre: 60 }
      const v = vision()
      return {
        id: `p${i}`,
        orientation: o,
        source,
        largeur: 2048,
        hauteur: 1536,
        incidence: null,
        lecture: { vision: v, resultat: tirerOuvertures(v, mur, 4 / 3, null, 'artisan'), mur },
        ecartees: [],
        auteur: null,
        licence: null,
        pris_le: '2026-09-29T10:00:00Z',
      }
    })
}

describe('une ouverture retirée', () => {
  const r = lire('deux-pans-simple')
  const [photo] = photosDe(r)

  it('sort de la surface, sans relire la photo', () => {
    const avant = resultatRetenu(photo)!
    const apres = resultatRetenu({ ...photo, ecartees: [2] })!
    expect(apres.nombre).toBe(avant.nombre - 1)
    expect(apres.parType.porte).toBeUndefined()
    expect(apres.surface!).toBeLessThan(avant.surface!)
  })

  it('ne change rien quand aucune n’est retirée', () => {
    expect(resultatRetenu(photo)).toBe(photo.lecture!.resultat)
  })

  it('la photo de l’artisan passe avant celle de la rue', () => {
    const rue = { ...photo, id: 'rue', source: 'panoramax' as const }
    expect(photoDeLaFacade([rue, photo], photo.orientation)!.id).toBe(photo.id)
    // Sans photo d'artisan : la photo de rue déjà lue.
    const nonLue = { ...rue, id: 'x', lecture: null }
    expect(photoDeLaFacade([nonLue, rue], photo.orientation)!.id).toBe('rue')
  })
})

describe('les ouvertures au dossier', () => {
  const r = lire('deux-pans-simple')
  const photos = photosDe(r)

  it('donne la façade nette quand chaque façade a sa photo', () => {
    const q = quantitesDesOuvertures(r, photos)
    const ouv = q.find((x) => x.cle === 'ouvertures_surface')!.valeur
    const nette = q.find((x) => x.cle === 'facade_nette')!.valeur
    const brute = quantitesDuReleve(r).find((x) => x.cle === 'facades_total')!.valeur
    expect(nette).toBeCloseTo(brute - ouv, 1)
    expect(q.find((x) => x.cle === 'ouvertures')!.valeur).toBe(3 * photos.length)
  })

  it('tait la nette s’il manque une façade', () => {
    const q = quantitesDesOuvertures(r, photos.slice(1))
    expect(q.map((x) => x.cle)).toEqual(['ouvertures', 'ouvertures_surface'])
  })

  it('ne dit rien sans photo lue', () => {
    expect(quantitesDesOuvertures(r, [])).toEqual([])
  })
})

describe('le rapport', () => {
  const r = lire('croupe')
  const photos = photosDe(r)
  const rapport = rapportMetre({ titre: 'M. Test', adresse: '1 rue de la Paix', date: new Date('2026-09-29'), releve: r, pans: null, photos, materiaux: null })

  it('dit les chiffres du dossier', () => {
    const q = Object.fromEntries([...quantitesDuReleve(r), ...quantitesDesOuvertures(r, photos)].map((x) => [x.cle, x.valeur]))
    expect(rapport.toiture.surface).toBe(q.toit_surface)
    expect(rapport.totalFacades.brute).toBeCloseTo(q.facades_total, 1)
    expect(rapport.totalFacades.nette).toBeCloseTo(q.facade_nette, 1)
    for (const l of rapport.lineaires) {
      const cle = { faitage: 'faitage', aretier: 'aretiers', noue: 'noues', egout: 'egouts', rive: 'rives' }[l.type]
      expect(l.longueur).toBeCloseTo(q[cle], 1)
    }
  })

  it('lit le matériau des murs sur la photo, et cite ses sources', () => {
    expect(rapport.materiaux.murs?.libelle).toBe('enduit gratté')
    expect(rapport.sources.some((s) => s.includes('LiDAR HD'))).toBe(true)
    expect(rapport.sources.at(-1)).toMatch(/confirmer sur place/)
  })

  it('prend le matériau déclaré à la BDNB, faute de lecture', () => {
    const b = rapportMetre({ titre: null, adresse: null, date: new Date(), releve: r, pans: null, photos: [], materiaux: null, bdnb: { toit: 'TUILES', murs: 'PIERRE' } })
    expect(b.materiaux.toit).toEqual({ libelle: 'Tuile mécanique', provenance: 'déclaré (BDNB)' })
    expect(b.totalFacades.nette).toBeNull()
  })

  it('s’ouvre dans Excel : BOM, point-virgule, virgule décimale', () => {
    const csv = csvDuRapport(rapport)
    expect(csv.startsWith('﻿')).toBe(true)
    const ligne = csv.split('\r\n').find((l) => l.startsWith('Toiture;Total compté'))!
    expect(ligne.split(';')[2]).toBe(String(rapport.toiture.surface).replace('.', ','))
  })
})

describe('le matériau du toit', () => {
  it('traduit la BDNB', () => {
    expect(materiauDeBdnb('TUILES')).toBe('tuile_mecanique')
    expect(materiauDeBdnb('ARDOISES')).toBe('ardoise')
    expect(materiauDeBdnb('ZINC ALUMINIUM')).toBe('zinc')
    expect(materiauDeBdnb('BETON')).toBe('membrane')
    expect(materiauDeBdnb('INDETERMINE')).toBeNull()
    expect(materiauDeBdnb(null)).toBeNull()
  })

  it('cadre le toit dans l’extrait, marge comprise', () => {
    const c = cadreDuToit(lire('croupe'), 20)
    expect(Math.max(c.largeur, c.hauteur)).toBeGreaterThanOrEqual(512)
    expect(Math.max(c.largeur, c.hauteur)).toBeLessThanOrEqual(1024)
    for (const [x, y] of c.contour) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(1000)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(1000)
    }
  })

  it('impose toutes ses clés à la réponse', () => {
    expect(SCHEMA_TOIT.required).toEqual(Object.keys(SCHEMA_TOIT.properties))
  })

  it('ne compte fenêtres de toit et cheminées qu’à 5 cm', () => {
    const toit = { meme_batiment: true, materiau: 'ardoise' as const, couleur: 'gris', confiance: 'haute' as const, fenetres_toit: 2, cheminees: 1, panneaux_solaires: false, remarque: '' }
    expect(quantitesDuToitLu({ toit, resolution_cm: 5, lu_le: '2026-09-29', lu_par: null, modele: null }).map((q) => q.cle)).toEqual(['fenetres_toit', 'cheminees'])
    expect(quantitesDuToitLu({ toit: { ...toit, meme_batiment: false }, resolution_cm: 5, lu_le: '', lu_par: null, modele: null })).toEqual([])
  })
})
