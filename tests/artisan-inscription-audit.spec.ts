import { expect, test, type Page } from '@playwright/test'
import { installerBackend, liensInscription } from './helpers/interface-backend'
import { CONTRAT_MODELE } from '../src/features/contrats/contrat-modele'

const lien = liensInscription.find((l) => l.canal === 'email' && l.taux === 20)!

const url = `/rejoindre/${lien.token}`
const contrat = { id: 'contrat-fictif', type: 'engagement', contenu: CONTRAT_MODELE.replaceAll('{{TAUX}}', '20').replace(/{{[^}]+}}/g, 'Information fictive'), statut: 'envoye', signed_at: null, signataire_nom: null, signature_data: null, apporteur_signature: null, artisan: { nom: 'Durand', prenom: 'Sam', societe: 'Atelier fictif' } }
async function inscription(page: Page) {
  const backend = await installerBackend(page, { connecte: false })
  const payloads: Record<string, unknown>[] = []
  await page.route('https://nominatim.openstreetmap.org/search?*', (r) => r.fulfill({ json: [{ lat: '45.76', lon: '4.84' }] }))
  await page.route('**/rest/v1/rpc/lien_inscription_artisan', (r) => r.fulfill({ json: { ok: true, taux: 20 } }))
  await page.route('**/rest/v1/rpc/inscrire_artisan', (r) => { payloads.push(r.request().postDataJSON().p_payload); return r.fulfill({ json: { ok: true, contrat_token: 'contrat-fictif', espace_token: 'espace-fictif', taux_commission: 0.20 } }) })
  await page.route('**/rest/v1/rpc/get_contrat_by_token', (r) => r.fulfill({ json: contrat }))
  return { ...backend, payloads }
}
async function coordonnees(page: Page) {
  for (const [name, value] of [['Nom *', 'Durand'], ['Prénom (facultatif)', 'Sam'], ['Téléphone *', '0600000000'], ['Email *', 'fictif@example.test']]) await page.getByRole('textbox', { name, exact: true }).fill(value)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
}
async function entreprise(page: Page) {
  for (const [name, value] of [['Nom de l’entreprise *', 'Atelier fictif'], ['Adresse de l’entreprise *', '1 rue fictive'], ['Code postal *', '69001'], ['Ville *', 'Lyon'], ['SIREN ou SIRET *', '12345678900012']]) await page.getByRole('textbox', { name, exact: true }).fill(value)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
}
async function secteur(page: Page) {
  await coordonnees(page)
  await entreprise(page)
  await page.getByRole('button', { name: 'Peinture', exact: true }).click()
}
async function departement(page: Page) {
  await page.getByRole('button', { name: /Par départements/ }).click()
  await page.getByLabel('Sélectionnez vos départements *', { exact: true }).selectOption('69')
}
async function verifierLargeur(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
}
async function dessiner(page: Page) {
  const canvas = page.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 35)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 70, { steps: 10 })
  await page.mouse.move(box.x + 150, box.y + 30, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'Backend fictif obligatoire')
  page.setDefaultTimeout(10_000)
})

test('le lien copié ne révèle ni canal ni taux', async ({ page, context }) => {
  const backend = await installerBackend(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/artisans')
  await page.getByRole('button', { name: "Lien d'inscription", exact: true }).click()
  await page.getByRole('button', { name: 'Copier 20 %', exact: true }).first().click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  const general = liensInscription.find((l) => l.canal === 'lien' && l.taux === 20)!
  expect(url).toBe(`http://127.0.0.1:5180/rejoindre/${general.token}`)
  expect(new URL(url).search).toBe('')
  expect(backend.requetesNonSimulees).toEqual([])
})

test('un taux ajouté à l’URL ne remplace pas celui du lien au contrat', async ({ page }) => {
  const backend = await inscription(page)
  await page.goto(`${url}?taux=10`)
  await expect(page.getByRole('heading', { name: 'Devenez partenaire Celexia' })).toBeVisible()
  await secteur(page)
  await departement(page)
  await expect(page.getByRole('list', { name: 'Départements sélectionnés' })).toContainText('Rhône')
  await expect(page.getByRole('button', { name: '+ Ajouter', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vérifiez vos informations' })).toBeVisible()
  expect(backend.payloads).toHaveLength(0)
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
  await expect(page.getByText('20 % du montant TTC des devis signés', { exact: true })).toBeVisible()
  expect(backend.payloads).toHaveLength(1)
  expect(backend.payloads[0]).toMatchObject({ invitation_token: lien.token, siren: '123456789', departements_couverts: ['69'], zones_couvertes: [], latitude: 45.76, longitude: 4.84 })
  expect(backend.payloads[0]).not.toHaveProperty('taux_commission')
  expect(backend.payloads[0]).not.toHaveProperty('source')
  expect(backend.requetesNonSimulees).toEqual([])
  expect(backend.erreursPage).toEqual([])
})

test('un lien modifié, ancien ou incomplet ne donne pas de formulaire', async ({ page }) => {
  await installerBackend(page, { connecte: false })
  await page.route('**/rest/v1/rpc/lien_inscription_artisan', (r) => r.fulfill({ json: { ok: false, error: 'lien_invalide' } }))
  for (const path of ['/rejoindre/email?taux=10', '/rejoindre?taux=10', `/rejoindre/${'0'.repeat(64)}`]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Demandez un nouveau lien' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuer' })).toHaveCount(0)
  }
})

test('une résolution indisponible peut être réessayée sans taux de repli', async ({ page }) => {
  await installerBackend(page, { connecte: false })
  let appels = 0
  await page.route('**/rest/v1/rpc/lien_inscription_artisan', (r) => {
    appels++
    return appels === 1 ? r.fulfill({ status: 503, json: { message: 'Panne fictive' } })
      : r.fulfill({ json: { ok: true, taux: 20, canal: 'email' } })
  })
  await page.goto(`/rejoindre/${lien.token}`)
  await expect(page.getByRole('heading', { name: 'Invitation indisponible' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continuer' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Devenez partenaire Celexia' })).toBeVisible()
})

test('les champs manquants sont signalés, et les retours ou actualisations conservent la saisie', async ({ page }) => {
  const backend = await inscription(page)
  await page.goto(url)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByText('Indiquez votre nom.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Nom *', exact: true })).toBeFocused()
  await coordonnees(page)
  await page.getByRole('textbox', { name: 'Nom de l’entreprise *', exact: true }).fill('Entreprise mémorisée')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Votre entreprise', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Nom de l’entreprise *', exact: true })).toHaveValue('Entreprise mémorisée')
  await page.getByRole('button', { name: 'Retour', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Email *', exact: true })).toHaveValue('fictif@example.test')
  expect(backend.payloads).toHaveLength(0)
})

test('la ville proposée et son rayon sont enregistrés sans bouton Ajouter', async ({ page }) => {
  const backend = await inscription(page)
  await page.goto(url)
  await secteur(page)
  await expect(page.getByRole('textbox', { name: 'Ville d’intervention *', exact: true })).toHaveValue('Lyon')
  await page.getByLabel('Distance autour de cette ville', { exact: true }).selectOption('50')
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByText('Lyon (69001) et les environs à 50 km')).toBeVisible()
  await page.getByRole('button', { name: 'Modifier : Vos coordonnées', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nom *', exact: true }).fill('Durand corrigé')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByText('Sam Durand corrigé', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
  expect(backend.payloads[0]).toMatchObject({ nom: 'Durand corrigé', zones_couvertes: [{ ville: 'Lyon', rayon_km: 50, lat: 45.76, lon: 4.84 }] })
})

test('plusieurs secteurs : une ligne vide est signalée, une ville remplie est retenue directement', async ({ page }) => {
  const backend = await inscription(page)
  await page.goto(url)
  await secteur(page)
  await page.getByRole('button', { name: 'Couvrir une autre ville', exact: true }).click()
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByText('Indiquez la ville de ce secteur.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Ville d’intervention *', exact: true }).nth(1).fill('Nantes')
  await page.getByRole('textbox', { name: 'Code postal *', exact: true }).nth(1).fill('44000')
  await page.getByRole('textbox', { name: 'Autre métier (facultatif)', exact: true }).fill('Ferronnerie')
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByText('Nantes (44000) et les environs à 30 km')).toBeVisible()
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
  expect(backend.payloads[0].zones_couvertes).toHaveLength(2)
  expect(backend.payloads[0].metiers).toEqual(['Peinture', 'Ferronnerie'])
})

test('un géocodage indisponible permet de corriger ou de réessayer sans perdre sa ville', async ({ page }) => {
  await inscription(page)
  let panne = true
  await page.route('https://nominatim.openstreetmap.org/search?*', (r) => r.fulfill({ json: panne ? [] : [{ lat: '45.76', lon: '4.84' }] }))
  await page.goto(url)
  await secteur(page)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByText(/Cette ville n’a pas pu être localisée/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Ville d’intervention *', exact: true })).toHaveValue('Lyon')
  panne = false
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vérifiez vos informations' })).toBeVisible()
})

test('les départements sont immédiats, retirables et distincts du mode ville', async ({ page }) => {
  const backend = await inscription(page)
  await page.goto(url)
  await secteur(page)
  await departement(page)
  await page.getByLabel('Sélectionnez vos départements *', { exact: true }).selectOption('01')
  await page.getByRole('button', { name: 'Retirer Rhône', exact: true }).click()
  await page.getByRole('button', { name: /Autour d’une ville/ }).click()
  await expect(page.getByRole('textbox', { name: 'Ville d’intervention *', exact: true })).toHaveValue('Lyon')
  await page.getByRole('button', { name: /Par départements/ }).click()
  await expect(page.getByRole('list', { name: 'Départements sélectionnés' })).toContainText('Ain')
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
  expect(backend.payloads[0]).toMatchObject({ departements_couverts: ['01'], zones_couvertes: [] })
})

test('la recherche entreprise reste facultative et son résultat est vérifiable', async ({ page }) => {
  await inscription(page)
  let panne = true
  await page.route('https://recherche-entreprises.api.gouv.fr/search?*', (r) => r.fulfill(panne ? { status: 503, json: {} } : { json: { results: [{ siren: '123456789', nom_complet: 'Atelier trouvé', nature_juridique: '5720', siege: { adresse: '1 rue de test', code_postal: '69001', libelle_commune: 'Lyon' } }] } }))
  await page.goto(url)
  await coordonnees(page)
  await page.getByRole('textbox', { name: 'Rechercher votre entreprise' }).fill('Atelier')
  await page.getByRole('button', { name: 'Chercher', exact: true }).click()
  await expect(page.getByText(/La recherche est indisponible/)).toBeVisible()
  panne = false
  await page.getByRole('button', { name: 'Chercher', exact: true }).click()
  await page.getByRole('button', { name: /Atelier trouvé/ }).click()
  await expect(page.getByRole('textbox', { name: 'Nom de l’entreprise *', exact: true })).toHaveValue('Atelier trouvé')
  await expect(page.getByRole('textbox', { name: 'Ville *', exact: true })).toHaveValue('Lyon')
})

test('un contrat en panne peut être réessayé, et une actualisation ne recrée pas l’artisan', async ({ page }) => {
  const backend = await inscription(page)
  let panne = true
  await page.route('**/rest/v1/rpc/get_contrat_by_token', (r) => r.fulfill(panne ? { status: 503, json: {} } : { json: contrat }))
  await page.goto(url)
  await secteur(page)
  await departement(page)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre contrat est momentanément indisponible' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Votre contrat est momentanément indisponible' })).toBeVisible()
  panne = false
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
  expect(backend.payloads).toHaveLength(1)
})

test('un refus d’inscription conserve le récapitulatif et un double clic ne double pas l’envoi', async ({ page }) => {
  await inscription(page)
  let appels = 0
  await page.route('**/rest/v1/rpc/inscrire_artisan', (r) => {
    appels++
    return r.fulfill(appels === 1 ? { status: 503, json: {} } : { json: { ok: true, contrat_token: 'contrat-fictif', taux_commission: 0.20 } })
  })
  await page.goto(url)
  await secteur(page)
  await departement(page)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  const lire = page.getByRole('button', { name: 'Lire mon contrat', exact: true })
  await lire.click()
  await expect(page.getByRole('alert')).toContainText('votre saisie est conservée')
  await expect(page.getByText('Atelier fictif', { exact: true })).toBeVisible()
  await lire.evaluate((bouton: HTMLButtonElement) => { bouton.click(); bouton.click() })
  await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
  expect(appels).toBe(2)
})

test('une inscription créée sans lien contrat ne présente ni écran vide ni nouvelle inscription', async ({ page }) => {
  await inscription(page)
  let appels = 0
  await page.route('**/rest/v1/rpc/inscrire_artisan', (r) => { appels++; return r.fulfill({ json: { ok: true, taux_commission: 0.20 } }) })
  await page.goto(url)
  await secteur(page)
  await departement(page)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Votre inscription est enregistrée' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Contacter Celexia', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Votre inscription est enregistrée' })).toBeVisible()
  expect(appels).toBe(1)
})

test('la signature résiste au redimensionnement et à une erreur réseau, puis ouvre la confirmation', async ({ page }) => {
  const backend = await inscription(page)
  let appels = 0
  await page.route('**/rest/v1/rpc/signer_contrat', (r) => { appels++; expect(r.request().postDataJSON().p_signature).toMatch(/^data:image\/png;base64,/); return r.fulfill(appels === 1 ? { status: 503, json: {} } : { json: { ok: true } }) })
  await page.goto(url)
  await secteur(page)
  await departement(page)
  await page.getByRole('button', { name: 'Continuer', exact: true }).click()
  await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
  const signer = page.getByRole('button', { name: 'Signer et accéder à mon espace', exact: true })
  await signer.click()
  await expect(page.getByText(/Confirmez avoir lu et approuvé/)).toBeVisible()
  await page.getByRole('checkbox').check()
  await signer.click()
  await expect(page.getByRole('alert')).toContainText('Dessinez votre signature')
  await dessiner(page)
  await page.setViewportSize({ width: 820, height: 700 })
  await verifierLargeur(page)
  await signer.click()
  await expect(page.getByRole('alert')).toContainText('Votre signature est conservée')
  await signer.click()
  await expect(page.getByRole('heading', { name: 'Bienvenue chez Celexia' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ouvrir mon espace artisan', exact: true })).toHaveAttribute('href', /\/artisan\/espace-fictif$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Bienvenue chez Celexia' })).toBeVisible()
  expect(appels).toBe(2)
  expect(backend.payloads).toHaveLength(1)
  expect(backend.erreursPage).toEqual([])
})

for (const largeur of [360, 768, 1440]) {
  test(`toutes les étapes de l’inscription sont lisibles à ${largeur}px`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Dimensions explicites ; parcours tactiles couverts séparément')
    await page.setViewportSize({ width: largeur, height: 900 })
    const backend = await inscription(page)
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'Vos coordonnées', exact: true })).toBeVisible()
    await verifierLargeur(page)
    await page.screenshot({ path: `test-results/inscription-contact-${largeur}.png`, fullPage: true })
    await coordonnees(page)
    await verifierLargeur(page)
    await page.screenshot({ path: `test-results/inscription-entreprise-${largeur}.png`, fullPage: true })
    await entreprise(page)
    await page.getByRole('button', { name: 'Peinture', exact: true }).click()
    await verifierLargeur(page)
    await page.screenshot({ path: `test-results/inscription-secteur-${largeur}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Continuer', exact: true }).click()
    await verifierLargeur(page)
    await page.screenshot({ path: `test-results/inscription-recap-${largeur}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Lire mon contrat', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Votre contrat d’engagement' })).toBeVisible()
    await verifierLargeur(page)
    await page.screenshot({ path: `test-results/inscription-contrat-${largeur}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Agrandir la lecture du contrat', exact: true }).click()
    await verifierLargeur(page)
    expect(backend.erreursPage).toEqual([])
    expect(backend.requetesNonSimulees).toEqual([])
  })
}
