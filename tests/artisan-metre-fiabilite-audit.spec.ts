import { expect, test, type Page } from '@playwright/test'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

const cleabs = 'BATIMENT0000000000000001'
const contour = [[2.35, 48.856], [2.35015, 48.856], [2.35015, 48.8561], [2.35, 48.8561]]

test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'API fictive obligatoire')
  page.setDefaultTimeout(10_000)
})

async function installer(page: Page, { maison = true, refusReleve = false } = {}) {
  const backend = await installerBackendArtisan(page)
  const appels: { nom: string; body: Record<string, unknown> }[] = []
  let wfsRepare = false
  await page.route('https://crm-test.supabase.co/**', async (route) => {
    const nom = new URL(route.request().url()).pathname.split('/').at(-1)!
    const connues = ['metre_contexte_by_token', 'batiment-chantier', 'releve-lidar', 'toiture-lidar', 'fiche-maison', 'metrage_by_token', 'metre-ia', 'facade-photo', 'enregistrer_metre_by_token']
    if (!connues.includes(nom)) return route.fallback()
    const body = route.request().postDataJSON() as Record<string, unknown>
    appels.push({ nom, body })
    let data: unknown
    switch (nom) {
      case 'metre_contexte_by_token': data = { ok: true, projet_id: 'chantier-demo-1', affectation_id: 'affectation-demo-1', client_adresse: 'Adresse fictive', client_ville: 'Ville de démonstration', metiers: ['Couverture'], metier: 'Couverture', metres: [] }; break
      case 'batiment-chantier': data = { ok: true, confiance: maison ? 'confirmee' : 'aucune', methode: maison ? 'confirmee' : null, principal: maison ? { cleabs, contour, aire: 122 } : null, autres: [], point: [2.350075, 48.85605], adresse_retrouvee: 'Adresse fictive', score: 1 }; break
      case 'releve-lidar': data = refusReleve ? { ok: false, error: 'indisponible' } : { ok: true, statut: 'hors_couverture', releve: null }; break
      case 'toiture-lidar': data = { ok: true, couvert: false, fiable: false, motif: 'hors_couverture' }; break
      case 'fiche-maison': data = { ok: true, sources: {}, bdnb: null, dpe: null, urbanisme: null, risques: null, cadastre: null }; break
      case 'metrage_by_token': data = { ok: true, metrage: [] }; break
      case 'metre-ia': data = { ok: true, trouve: false }; break
      case 'facade-photo': data = { ok: true, photos: [], materiaux: null }; break
      case 'enregistrer_metre_by_token': data = { ok: false, error: 'refus_fixture' }; break
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.route('https://data.geopf.fr/**', (route) => new URL(route.request().url()).pathname === '/wfs/ows'
    ? wfsRepare ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [{ id: 'batiment.123456', properties: { cleabs, hauteur: 6 }, geometry: { type: 'Polygon', coordinates: [[...contour, contour[0]]] } }] }) }) : route.fulfill({ status: 503, body: 'IGN temporairement indisponible' })
    : route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }))
  await page.goto(`${URL_ARTISAN_DEMO}?vue=metres`)
  await page.getByRole('button', { name: /Sophie Laurent/ }).click()
  const feuille = page.getByRole('dialog', { name: 'Sophie Laurent', exact: true })
  await expect(feuille).toBeVisible()
  return { ...backend, feuille, appels, reparerWfs: () => { wfsRepare = true } }
}

test('le contour identifié reste sélectionné quand le WFS voisinage tombe en panne', async ({ page }) => {
  const { feuille, appels } = await installer(page)
  await expect(feuille.getByText('Maison confirmée', { exact: true })).toBeVisible()
  await expect(feuille.getByRole('button', { name: 'Recharger les bâtiments' })).toBeVisible()
  await expect.poll(() => appels.some((a) => a.nom === 'releve-lidar' && a.body.cleabs === cleabs)).toBe(true)
  await expect(feuille.getByText(/Aucun bâtiment identifié/)).toHaveCount(0)
  await expect(feuille.locator('.leaflet-overlay-pane path').first()).toBeVisible()
  expect(appels.filter((a) => a.nom === 'enregistrer_metre_by_token')).toHaveLength(0)
})

test('le réessai du WFS enrichit la sélection de secours sans prendre la maison pour son propre voisin', async ({ page }) => {
  const { feuille, reparerWfs } = await installer(page)
  await expect(feuille.getByRole('button', { name: 'Recharger les bâtiments' })).toBeVisible()
  await feuille.locator('.leaflet-overlay-pane path').first().click({ force: true })
  reparerWfs()
  await feuille.getByRole('button', { name: 'Recharger les bâtiments' }).click()
  await expect(feuille.getByRole('button', { name: 'Recharger les bâtiments' })).toHaveCount(0)
  await expect(feuille.getByText('Maison confirmée', { exact: true })).toBeVisible()
  // La même maison reste surlignée ; le WFS apporte sa hauteur de 6 m.
  await expect(feuille.locator('.leaflet-overlay-pane path').first()).toBeVisible()
  await feuille.getByRole('button', { name: 'Façades', exact: true }).click()
  await feuille.getByRole('button', { name: /^nord ·/ }).click()
  await expect(feuille.getByText(/6 m selon/)).toBeVisible()
  await expect(feuille.getByText(/ce mur touche un autre bâtiment/)).toHaveCount(0)
})

test('un refus métier du relevé propose de réessayer sans afficher un faux résultat vide', async ({ page }) => {
  const { feuille, appels } = await installer(page, { refusReleve: true })
  await expect(feuille.getByRole('button', { name: 'Réessayer le relevé' })).toBeVisible()
  const avant = appels.filter((a) => a.nom === 'releve-lidar').length
  await feuille.getByRole('button', { name: 'Réessayer le relevé' }).click()
  await expect.poll(() => appels.filter((a) => a.nom === 'releve-lidar').length).toBeGreaterThan(avant)
})

test('une surface de deux points ne devient jamais une longueur enregistrable', async ({ page }) => {
  const { feuille, appels } = await installer(page, { maison: false })
  await feuille.getByRole('button', { name: 'Dessiner une surface' }).click()
  const carte = feuille.locator('.leaflet-container')
  await expect(carte).toBeVisible()
  const boite = (await carte.boundingBox())!
  await carte.click({ position: { x: boite.width * .35, y: boite.height * .55 } })
  await carte.click({ position: { x: boite.width * .65, y: boite.height * .55 } })
  await expect(feuille.getByText('2 points posés. Il faut au moins 3 points pour une surface.')).toBeVisible()
  await expect(feuille.getByRole('button', { name: 'Garder', exact: true })).toHaveCount(0)
  expect(appels.filter((a) => a.nom === 'enregistrer_metre_by_token')).toHaveLength(0)
  await carte.click({ position: { x: boite.width * .5, y: boite.height * .75 } })
  await expect(feuille.getByRole('button', { name: 'Garder', exact: true })).toBeVisible()
  await feuille.getByRole('button', { name: 'Garder', exact: true }).click()
  await expect.poll(() => appels.filter((a) => a.nom === 'enregistrer_metre_by_token').length).toBe(1)
  expect(appels.find((a) => a.nom === 'enregistrer_metre_by_token')?.body.p_type).toBe('surface')
})

test('les mesures terrain restent accessibles sans bâtiment identifié et sans IGN', async ({ page }, info) => {
  const { feuille } = await installer(page, { maison: false })
  await expect(feuille.getByText('Mesures du chantier', { exact: true })).toBeVisible()
  await expect(feuille.getByRole('button', { name: 'Recharger les bâtiments' })).toBeVisible()
  await expect(feuille.locator('details').filter({ has: page.getByText('Mesures du chantier', { exact: true }) })).toHaveAttribute('open', '')
  await expect(feuille.getByText('Aucun bâtiment identifié', { exact: false })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mesures-terrain-sans-ign.png'), fullPage: true })
})
