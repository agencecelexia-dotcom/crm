import { describe, expect, it } from 'vitest'
import { ETAPES_PREVUES, PHASES_IA } from '../../supabase/functions/_metre-ia-phases'
import type { Releve } from '../../supabase/functions/_releve'
import { ESSAIS_PAR_FACADE, trierPhotos, type PhotoRue } from '../../supabase/functions/_tri-photos'
import { photoDeLaFacade } from '../../supabase/functions/_ouvertures'

// Les photos de la rue : l'IA en regarde plusieurs par façade et écarte celles
// qui ne montrent pas la maison. Les phases de la lecture : photos, analyse,
// mesures, 3D.

const releve = {
  facades: [
    { orientation: 'sud', retrait: false, surfaceLibre: 40 },
    { orientation: 'nord', retrait: false, surfaceLibre: 30 },
    { orientation: 'est', retrait: false, surfaceLibre: 0 },
    { orientation: 'ouest', retrait: true, surfaceLibre: 20 },
  ],
} as unknown as Releve

const photo = (id: string, orientation: string, note: number, lecture: PhotoRue['lecture'] = null): PhotoRue => ({ id, orientation, chemin: `c/${id}.jpg`, note, lecture })
const bonne = { resultat: { utilisable: true, motif: null } }
const autre = { resultat: { utilisable: false, motif: 'autre_batiment' } }
const cachee = { resultat: { utilisable: false, motif: 'facade_invisible' } }

describe('le tri des photos de la rue', () => {
  it('retient la première photo qui montre le mur et écarte les mauvaises avant elle, avec leur raison', async () => {
    const lectures: Record<string, PhotoRue['lecture']> = { a: autre, b: cachee, c: bonne }
    const lues: string[] = []
    const t = await trierPhotos(releve, [photo('a', 'sud', 0.9), photo('b', 'sud', 0.8), photo('c', 'sud', 0.7)], async (id) => {
      lues.push(id)
      return { ok: true, lecture: lectures[id] }
    })
    expect(t.retenues.sud).toEqual({ id: 'c', chemin: 'c/c.jpg' })
    expect(t.ecartees).toEqual([
      { orientation: 'sud', raison: 'elle montre un autre bâtiment' },
      { orientation: 'sud', raison: 'la façade n’y est pas visible' },
    ])
    // Les meilleures d'abord : la note la plus haute est lue en premier.
    expect(lues).toEqual(['a', 'b', 'c'])
  })

  it('s’arrête dès qu’une photo est bonne : pas de lecture payante en trop', async () => {
    const lues: string[] = []
    await trierPhotos(releve, [photo('a', 'sud', 0.9), photo('b', 'sud', 0.8)], async (id) => {
      lues.push(id)
      return { ok: true, lecture: bonne }
    })
    expect(lues).toEqual(['a'])
  })

  it(`ne lit pas plus de ${ESSAIS_PAR_FACADE} photos par façade`, async () => {
    const lues: string[] = []
    const t = await trierPhotos(releve, Array.from({ length: 6 }, (_, i) => photo(`p${i}`, 'sud', 1 - i / 10)), async (id) => {
      lues.push(id)
      return { ok: true, lecture: cachee }
    })
    expect(lues).toHaveLength(ESSAIS_PAR_FACADE)
    expect(t.retenues.sud).toBeUndefined()
    expect(t.ecartees).toHaveLength(ESSAIS_PAR_FACADE)
  })

  it('ne relit pas une photo déjà lue, et la retient si elle est bonne', async () => {
    let appels = 0
    const t = await trierPhotos(releve, [photo('a', 'nord', 0.9, bonne)], async () => {
      appels++
      return { ok: true, lecture: bonne }
    })
    expect(appels).toBe(0)
    expect(t.retenues.nord?.id).toBe('a')
  })

  it('dit les façades sans photo, et ignore les murs en retrait ou mitoyens', async () => {
    const t = await trierPhotos(releve, [photo('a', 'sud', 0.9, bonne)], async () => ({ ok: true, lecture: bonne }))
    expect(t.sans_photo).toEqual(['nord'])
    expect(Object.keys(t.retenues)).toEqual(['sud'])
  })

  it('compte une lecture en échec comme écartée, sans planter', async () => {
    const t = await trierPhotos(releve, [photo('a', 'sud', 0.9)], async () => ({ ok: false, error: 'vision_occupee' }))
    expect(t.erreurs).toEqual(['sud : vision_occupee'])
    expect(t.ecartees[0].raison).toContain('pas pu la lire')
  })

  it('sans moyen de lire (le banc), ne lit rien et ne retient que les photos déjà lues', async () => {
    const t = await trierPhotos(releve, [photo('a', 'sud', 0.9), photo('b', 'nord', 0.9, bonne)], null)
    expect(t.retenues).toEqual({ nord: { id: 'b', chemin: 'c/b.jpg' } })
    expect(t.sans_photo).toEqual(['sud'])
  })
})

describe('la photo que la 3D utilise pour une façade', () => {
  const lue = (id: string, lecture: unknown, source = 'panoramax') => ({ id, orientation: 'sud', source, lecture }) as never
  it('préfère une photo exploitable à une photo lue mais mauvaise', () => {
    const mauvaise = lue('m', { resultat: { utilisable: false, motif: 'facade_invisible' } })
    const bon = lue('b', { resultat: { utilisable: true, motif: null } })
    expect((photoDeLaFacade([mauvaise, bon], 'sud') as unknown as { id: string }).id).toBe('b')
  })
  it('préfère toujours celle de l’artisan', () => {
    const bon = lue('b', { resultat: { utilisable: true, motif: null } })
    const art = lue('a', null, 'artisan')
    expect((photoDeLaFacade([bon, art], 'sud') as unknown as { id: string }).id).toBe('a')
  })
})

describe('les phases de la lecture', () => {
  it('sont quatre, dans l’ordre : photos, analyse, mesures, 3D', () => {
    expect(PHASES_IA.map((p) => p.titre)).toEqual(['Prise des photos', 'Analyse des photos', 'Mesures', 'Construction de la 3D'])
  })
  it('chaque étape appartient à une phase, et les phases se suivent sans retour en arrière', () => {
    const phases = ETAPES_PREVUES.map((e) => e.phase)
    expect([...phases].sort()).toEqual(phases)
    expect(new Set(phases)).toEqual(new Set([1, 2, 3, 4]))
    expect(new Set(ETAPES_PREVUES.map((e) => e.cle)).size).toBe(ETAPES_PREVUES.length)
  })
  it('finissent par le modèle 3D', () => {
    expect(ETAPES_PREVUES[ETAPES_PREVUES.length - 1].cle).toBe('modele')
  })
})
