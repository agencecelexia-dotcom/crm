import { expect, test, type Page } from '@playwright/test'
import { installerBackend } from './helpers/interface-backend'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

const partenaire = { id: 'artisan-robert', type: 'partenaire', nom: 'Robert Rénovation', ville: 'Rennes', telephone: '+33 6 00 00 00 03', email: 'robert@example.test', detail: 'Alexandre Robert · Rénovation', statut: null, masque: false }
const projet = { id: 'projet-1', type: 'projet', nom: 'Sophie Laurent', ville: 'Lyon', telephone: '0600000010', email: 'sophie@example.test', detail: 'Couverture', statut: 'nouveau', masque: true }
const rpc = '**/rest/v1/rpc/recherche_globale'
async function ouvrir(page: Page) {
  await page.getByRole('button', { name: 'Recherche globale', exact: true }).click()
  const boite = page.getByRole('dialog', { name: 'Recherche globale', exact: true })
  await expect(boite.getByRole('combobox')).toBeFocused()
  return boite
}
async function sansDebordement(page: Page) {
  const dimensions = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, ecran: innerWidth }))
  expect(dimensions.contenu, `Débordement sur ${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBeLessThanOrEqual(dimensions.ecran)
}
test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'API fictive obligatoire')
  page.setDefaultTimeout(10_000)
})

test('un numéro ouvre directement la fiche partenaire depuis toute page', async ({ page }) => {
  const backend = await installerBackend(page)
  const recherches: string[] = []
  await page.route(rpc, async (r) => { recherches.push(r.request().postDataJSON().p_recherche); await r.fulfill({ json: { total: 1, resultats: [partenaire] } }) })
  await page.goto('/commissions')
  const boite = await ouvrir(page)
  expect(recherches).toEqual([])
  await boite.getByRole('combobox').fill('+33 6 00 00 00 03')
  await boite.getByRole('option', { name: /Robert Rénovation/ }).click()
  await expect(page).toHaveURL(/\/artisans\/artisan-robert$/)
  await expect(boite).toHaveCount(0)
  expect(recherches).toEqual(['+33 6 00 00 00 03'])
  expect(backend.erreursPage).toEqual([])
})

test('email et projet masqué : accès à la fiche sans changer le filtre du pipeline', async ({ page }) => {
  await installerBackend(page)
  await page.route(rpc, (r) => r.fulfill({ json: { total: 1, resultats: [projet] } }))
  await page.goto('/projets')
  const boite = await ouvrir(page)
  await boite.getByRole('combobox').fill('sophie@example.test')
  await expect(boite.getByText('Masqué', { exact: true })).toBeVisible()
  await boite.getByRole('option', { name: /Sophie Laurent/ }).click()
  await expect(page).toHaveURL(/\/projets\/projet-1$/)
  await expect(page.getByRole('heading', { name: /Sophie Laurent/ })).toBeVisible()
})

test('raccourci clavier, ville et navigation au clavier dans les résultats', async ({ page }) => {
  await installerBackend(page)
  await page.route(rpc, (r) => r.fulfill({ json: { total: 2, resultats: [partenaire, projet] } }))
  await page.goto('/artisans')
  await page.keyboard.press('Control+k')
  const boite = page.getByRole('dialog', { name: 'Recherche globale' })
  await boite.getByRole('combobox').fill('Lyon')
  await expect(boite.getByRole('option')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/(?:artisans\/artisan-robert|projets\/projet-1)$/)
  await page.keyboard.press('Control+k')
  await expect(boite).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(boite).toHaveCount(0)
})

test('la recherche distingue panne et absence de résultat, puis reprend', async ({ page }) => {
  await installerBackend(page)
  let appels = 0
  await page.route(rpc, (r) => ++appels === 1 ? r.fulfill({ status: 503, json: { message: 'Panne fictive' } }) : r.fulfill({ json: { total: 0, resultats: [] } }))
  await page.goto('/projets')
  const boite = await ouvrir(page)
  await boite.getByRole('combobox').fill('Introuvable')
  await expect(boite.getByRole('alert')).toBeVisible()
  await boite.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(boite.getByText(/Aucune fiche trouvée/)).toBeVisible()
  expect(appels).toBe(2)
})

test('changer de recherche retire les anciennes fiches et fermer restitue le focus', async ({ page }) => {
  await installerBackend(page)
  await page.route(rpc, (r) => r.fulfill({ json: { total: 1, resultats: [r.request().postDataJSON().p_recherche === 'Rennes' ? partenaire : projet] } }))
  await page.goto('/projets')
  const boite = await ouvrir(page)
  await boite.getByRole('combobox').fill('Rennes')
  await expect(boite.getByRole('option', { name: /Robert Rénovation/ })).toBeVisible()
  await boite.getByRole('combobox').fill('Lyon')
  await expect(boite.getByRole('option', { name: /Robert Rénovation/ })).toHaveCount(0)
  await expect(boite.getByRole('option', { name: /Sophie Laurent/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Recherche globale', exact: true })).toBeFocused()
})

for (const largeur of [360, 768, 1024, 1440]) {
  test(`mise en page agence et artisan à ${largeur}px`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Dimensions explicites ; parcours tactiles couverts séparément')
    await page.setViewportSize({ width: largeur, height: 900 })
    const backend = await installerBackend(page)
    await page.route('**/rest/v1/rpc/fonctionnalites_espace_artisan', (r) => r.fulfill({ json: { devis: false, metres: false, chantiers: true, commissions: true, entreprise: true, aide: true } }))
    await page.route(rpc, (r) => r.fulfill({ json: { total: 2, resultats: [{ ...partenaire, email: 'contact.entreprise.au.nom.tres.long@example.test' }, projet] } }))
    for (const route of ['/', '/projets', '/projets?vue=pipeline', '/artisans', '/commissions', '/parametres/crm-artisan']) {
      await page.goto(route)
      await expect(page.locator('main h1').first()).toBeVisible()
      await sansDebordement(page)
    }
    await page.goto('/projets?vue=liste')
    const premiere = page.getByRole('list', { name: 'Projets', exact: true }).locator(':scope > li').first()
    await expect(premiere).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(premiere).not.toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: `test-results/agence-couleurs-${largeur}.png`, fullPage: true })
    const boite = await ouvrir(page)
    await boite.getByRole('combobox').fill('Lyon')
    await expect(boite.getByRole('option')).toHaveCount(2)
    await sansDebordement(page)
    await page.screenshot({ path: `test-results/recherche-globale-${largeur}.png` })
    expect(backend.erreursPage).toEqual([])
    await page.keyboard.press('Escape')
    // Le backend agence est installé sur la page, celui de l'artisan sur
    // le contexte : retirer le premier pour ne pas masquer le second.
    await page.unrouteAll({ behavior: 'wait' })
    await page.addInitScript(() => localStorage.clear())
    const artisan = await installerBackendArtisan(page, { fonctionnalites: { devis: false, metres: false } })
    for (const vue of ['chantiers', 'commissions', 'entreprise', 'aide']) {
      await page.goto(`${URL_ARTISAN_DEMO}?vue=${vue}`)
      await expect(page.locator('h1').first()).toBeVisible()
      await sansDebordement(page)
    }
    await page.goto(URL_ARTISAN_DEMO)
    await expect(page.getByRole('heading', { name: 'Mes chantiers', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/artisan-layout-${largeur}.png`, fullPage: true })
    expect(artisan.erreursPage).toEqual([])
    expect(artisan.requetesNonSimulees).toEqual([])
  })
}
