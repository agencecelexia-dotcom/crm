import { describe, expect, it, vi } from 'vitest'
import { cheminDepotPhoto, depotPhotoAutorise, photoVisiblePourArtisan, verifierAccesPhoto } from '../../supabase/functions/_acces-photo'

const batiment = 'BATIMENT0000000000000001'
const autreBatiment = 'BATIMENT0000000000000002'
const artisan = '00000000-0000-4000-8000-000000000001'
const autre = '00000000-0000-4000-8000-000000000002'
const id = '00000000-0000-4000-8000-000000000003'
const publique = { cleabs: batiment, source: 'panoramax', deposee_par: null }
const privee = { cleabs: batiment, source: 'artisan', deposee_par: artisan }

describe('Photos : cache public partagé, dépôts privés isolés', () => {
  it('partage les photos de rue et conserve les propres dépôts de l’artisan', () => {
    expect(photoVisiblePourArtisan(publique, artisan)).toBe(true)
    expect(photoVisiblePourArtisan(privee, artisan)).toBe(true)
    expect(photoVisiblePourArtisan(privee, autre)).toBe(false)
    expect(photoVisiblePourArtisan({ ...privee, deposee_par: null }, artisan)).toBe(false)
    expect(photoVisiblePourArtisan(privee, null)).toBe(true) // agence déjà authentifiée
  })
  it.each(['chercher', 'deposer', 'enregistrer', 'materiau_toit'])('%s exige le lien avec un chantier autorisé', async (action) => {
    const garde = vi.fn().mockResolvedValue('batiment_non_attribue')
    const photo = vi.fn()
    expect(await verifierAccesPhoto({ artisan }, action, { cleabs: batiment }, { photo, batiment: garde })).toEqual({ ok: false, error: 'batiment_non_attribue', status: 403 })
    expect(garde).toHaveBeenCalledExactlyOnceWith(batiment)
    expect(photo).not.toHaveBeenCalled()
  })
  it.each(['lire', 'ecarter'])('%s vérifie le bâtiment stocké et ignore le bâtiment falsifié du corps', async (action) => {
    const garde = vi.fn().mockResolvedValue('batiment_non_attribue')
    const photo = vi.fn().mockResolvedValue(publique)
    expect(await verifierAccesPhoto({ artisan }, action, { id, cleabs: autreBatiment }, { photo, batiment: garde })).toMatchObject({ ok: false, status: 403 })
    expect(garde).toHaveBeenCalledExactlyOnceWith(batiment)
  })
  it.each(['lire', 'ecarter'])('%s refuse la photo personnelle d’un autre artisan même du même bâtiment', async (action) => {
    const garde = vi.fn().mockResolvedValue(null)
    expect(await verifierAccesPhoto({ artisan: autre }, action, { id }, { photo: async () => privee, batiment: garde })).toEqual({ ok: false, error: 'acces_refuse', status: 403 })
    expect(garde).not.toHaveBeenCalled()
  })
  it.each(['chercher', 'deposer', 'enregistrer', 'materiau_toit', 'lire', 'ecarter'])('%s reste possible pour un artisan autorisé', async (action) => {
    expect(await verifierAccesPhoto({ artisan }, action, { id, cleabs: batiment }, { photo: async () => privee, batiment: async () => null })).toMatchObject({ ok: true })
  })
  it('la session agence validée conserve l’accès aux photos sans affectation artisan', async () => {
    const garde = vi.fn()
    expect(await verifierAccesPhoto({ artisan: null }, 'lire', { id }, { photo: async () => privee, batiment: garde })).toMatchObject({ ok: true })
    expect(garde).not.toHaveBeenCalled()
  })
  it('un enregistrement ne peut pas réutiliser un chemin signé pour un autre acteur', () => {
    const chemin = cheminDepotPhoto(batiment, artisan, id)
    expect(depotPhotoAutorise(chemin, batiment, artisan)).toBe(true)
    expect(depotPhotoAutorise(chemin, batiment, autre)).toBe(false)
    expect(depotPhotoAutorise(chemin, autreBatiment, artisan)).toBe(false)
    expect(depotPhotoAutorise(`${batiment}/artisan-${artisan}-../autre.jpg`, batiment, artisan)).toBe(false)
    expect(depotPhotoAutorise(`${chemin}?objet=autre`, batiment, artisan)).toBe(false)
  })
})
