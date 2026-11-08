import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LigneMetrage } from '../../src/features/metre/use-metrage'
import type { CarteMesure } from '../../src/features/metre/fiche-mesures'

const etat = vi.hoisted(() => ({ lignes: [] as LigneMetrage[], pending: false, error: false }))
vi.mock('../../src/features/metre/use-metrage', () => ({
  useMetrageArtisan: () => ({ data: etat.lignes, isPending: etat.pending, isError: etat.error, refetch: vi.fn() }),
  useCorrigerMetrageArtisan: () => ({ mutate: vi.fn(), isPending: false }),
  useMetrageProjet: () => ({ data: etat.lignes, isPending: etat.pending, isError: etat.error, refetch: vi.fn() }),
  useDeclarerMetrage: () => ({ mutate: vi.fn(), isPending: false }),
  useTrancherMetrage: () => ({ mutate: vi.fn(), isPending: false }),
}))
import { FicheMesures, SaisieTerrainMetres } from '../../src/features/metre/fiche-mesures'
import { valeurLisible } from '../../src/features/metre/affichage-metrage'
import { DossierMetrage } from '../../src/features/metre/dossier-metrage'
import { formatHauteurMesuree } from '../../src/features/metre/affichage-releve'
import { lireValeurMetrage, resoudreValeurMetrage } from '../../src/features/metre/valeurs-metrage'
import { PAR_METIER, quantitesDuChantier } from '../../src/features/metre/catalogue-metrage'

const carte: CarteMesure = { cle: 'toit_surface', libelle: 'Surface du toit', unite: 'm2', valeur: null }
const ligne: LigneMetrage = {
  cle: 'toit_surface', unite: 'm2', valeur_declaree: null, declaree_par: null, citation: null,
  valeur_mesuree: 104, mesure_source: 'lidar', statut: 'mesure', valeur_retenue: 104,
  retenue_par: 'outil', note: null,
}
const afficher = (c: CarteMesure = carte) => renderToStaticMarkup(<FicheMesures token="test-fictif" affectationToken="test-chantier" cartes={[c]} />)

describe('audit : valeurs réellement connues du chantier', () => {
  beforeEach(() => { etat.lignes = []; etat.pending = false; etat.error = false })
  it('retrouve la quantité du dossier quand le calcul local est absent', () => {
    etat.lignes = [ligne]
    expect(afficher()).toContain('104 m²')
    expect(afficher()).not.toContain('>—</span>')
  })
  it('affiche une déclaration disponible sans la présenter comme une mesure terrain', () => {
    etat.lignes = [{ ...ligne, valeur_mesuree: null, valeur_retenue: 95, valeur_declaree: 95, statut: 'declare' }]
    expect(afficher()).not.toContain('>—</span>')
    expect(afficher()).toContain('dit par le client')
    expect(afficher()).not.toContain('✓ mesuré sur place')
  })
  it('ne remplace pas un versant sélectionné par la surface confirmée du toit entier', () => {
    etat.lignes = [{ ...ligne, statut: 'confirme', retenue_par: 'artisan', valeur_retenue: 112.5 }]
    const html = afficher({ ...carte, valeur: 48, portee: 'selection' } as CarteMesure)
    expect(html).toContain('48 m²')
    expect(html).not.toContain('112,5 m²')
    expect(html).not.toContain('✓ mesuré sur place')
  })
  it('ne réinterprète pas une longueur stockée comme une surface', () => {
    etat.lignes = [{ ...ligne, unite: 'ml', statut: 'confirme', retenue_par: 'artisan', valeur_retenue: 112.5 }]
    expect(afficher()).not.toContain('112,5 m²')
  })
  it('préserve une valeur nulle réellement confirmée, même pendant un calcul', () => {
    etat.lignes = [{ ...ligne, statut: 'confirme', retenue_par: 'artisan', valeur_retenue: 0 }]
    expect(afficher({ ...carte, enCours: true })).toContain('0 m²')
  })
  it('ne présente pas une valeur numérique invalide comme une mesure', () => {
    expect(valeurLisible(Number.NaN, 'm2')).toBe('—')
    expect(valeurLisible(Number.POSITIVE_INFINITY, 'm')).toBe('—')
    expect(valeurLisible(null, 'm')).toBe('—')
  })
  it('ne masque pas le calcul déjà visible pendant une panne du dossier, mais empêche sa confirmation aveugle', () => {
    etat.error = true
    const html = afficher({ ...carte, valeur: 104 })
    expect(html).toContain('104 m²')
    expect(html).toContain('Réessayer les valeurs du chantier')
    expect(html).not.toContain('Mesuré sur place')
  })
  it('ne masque pas le calcul visible pendant le chargement du dossier', () => {
    etat.pending = true
    expect(afficher({ ...carte, valeur: 104 })).toContain('104 m²')
    expect(afficher({ ...carte, valeur: 104 })).toContain('Chargement des valeurs du chantier')
  })
  it('un autre bâtiment garde ses dimensions propres même quand le dossier a une valeur confirmée', () => {
    etat.lignes = [{ ...ligne, statut: 'confirme', retenue_par: 'agence', valeur_retenue: 112.5 }]
    const html = renderToStaticMarkup(<FicheMesures token="test-fictif" affectationToken="test-chantier" dossierApplicable={false} cartes={[{ ...carte, valeur: 25 }]} />)
    expect(html).toContain('25 m²')
    expect(html).not.toContain('112,5')
    expect(html).not.toContain('Mesuré sur place')
  })
  it('une valeur dite par le client ne rebaptise pas le calcul local en déclaration', () => {
    const valeur = resoudreValeurMetrage({ ...carte, valeur: 104 }, { ...ligne, valeur_mesuree: null, valeur_declaree: 95, valeur_retenue: 95, statut: 'declare' })
    expect(valeur).toMatchObject({ valeur: 104, origine: 'calcul', statut: 'mesure', declaree: 95 })
  })
  it('un désaccord reste à vérifier, sans confirmation humaine inventée', () => {
    const valeur = resoudreValeurMetrage(carte, { ...ligne, statut: 'ecart', valeur_declaree: 180, valeur_retenue: null })
    expect(valeur).toMatchObject({ valeur: 104, origine: 'dossier', statut: 'ecart', humaine: null })
  })
  it('les hauteurs absentes et aberrantes ne deviennent pas des cotes nulles', () => {
    for (const v of [null, undefined, NaN, Infinity, -1]) expect(formatHauteurMesuree(v)).toBe('—')
    expect(formatHauteurMesuree(0)).toBe('0,0 m')
    expect(formatHauteurMesuree(5.87)).toBe('5,9 m')
  })
  it('le dossier agence distingue une panne d’une ligne absente', () => {
    etat.error = true
    const html = renderToStaticMarkup(<DossierMetrage projetId="chantier-fictif" metiers={['Couverture']} />)
    expect(html).toContain('Réessayer les métrés')
    expect(html).not.toContain('Le client dit')
    expect(html).not.toContain('Saisir une valeur vérifiée')
  })
  it('le dossier agence attend sa lecture avant de proposer des valeurs nouvelles', () => {
    etat.pending = true
    const html = renderToStaticMarkup(<DossierMetrage projetId="chantier-fictif" metiers={['Couverture']} />)
    expect(html).toContain('Chargement des métrés du chantier')
    expect(html).not.toContain('Le client dit')
  })
  it('l’agence peut renseigner directement une valeur vérifiée sans déclaration client préalable', () => {
    const html = renderToStaticMarkup(<DossierMetrage projetId="chantier-fictif" metiers={['Couverture']} />)
    expect(html).toContain('Saisir une valeur vérifiée')
  })
  it('le dossier agence ne confirme pas une unité incohérente', () => {
    etat.lignes = [{ ...ligne, unite: 'ml', statut: 'confirme', retenue_par: 'artisan', valeur_retenue: 112.5 }]
    const html = renderToStaticMarkup(<DossierMetrage projetId="chantier-fictif" metiers={['Couverture']} />)
    expect(html).toContain('L’unité enregistrée ne correspond pas')
    expect(html).not.toContain('112,5 m²')
  })
  it.each(Object.keys(PAR_METIER))('la saisie terrain %s existe sans bâtiment ni relevé', (metier) => {
    const html = renderToStaticMarkup(<SaisieTerrainMetres token="test-fictif" affectationToken="test-chantier" metiers={[metier]} />)
    for (const q of quantitesDuChantier([metier])) expect(html).toContain(q.libelle)
    expect(html).toContain('Mesuré sur place')
    expect(html).not.toContain('>0 m²<')
  })
  it('un métier inconnu demande la quantité plutôt que présumer une toiture', () => {
    const html = renderToStaticMarkup(<SaisieTerrainMetres token="test-fictif" affectationToken="test-chantier" metiers={['Métier inconnu']} />)
    expect(html).toContain('Choisir une quantité')
    expect(html).not.toContain('Mesuré sur place')
  })
})

describe('saisie de quantités entières et nombres français complets', () => {
  it.each(['12abc', '12 m2', '1 20', '1,2,3', '1e3', '-1', 'Infinity', '', '100001'])('refuse %j sans en extraire un faux nombre', (saisie) => {
    expect(lireValeurMetrage(saisie, 'm2')).toBeNull()
  })
  it.each([['120,5', 120.5], ['1 200,5', 1200.5], ['1\u202f200,5', 1200.5], ['0', 0], ['.5', 0.5], [' 12.5 ', 12.5]] as const)('lit %s sans perte', (saisie, attendu) => {
    expect(lireValeurMetrage(saisie, 'm2')).toBe(attendu)
  })
  it('ne confirme pas une demi-fenêtre ou un booléen hors domaine', () => {
    expect(lireValeurMetrage('1,5', 'u')).toBeNull()
    expect(lireValeurMetrage('2', 'oui_non')).toBeNull()
    expect(lireValeurMetrage('0', 'oui_non')).toBe(0)
    expect(lireValeurMetrage('1', 'oui_non')).toBe(1)
    expect(valeurLisible(0, 'oui_non')).toBe('non')
    expect(valeurLisible(2, 'oui_non')).toBe('—')
    expect(valeurLisible(1.5, 'u')).toBe('—')
  })
})
