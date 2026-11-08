import { expect, test, type Page } from '@playwright/test'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'API fictive obligatoire')
  page.setDefaultTimeout(10_000)
})

async function dessiner(page: Page) {
  const canvas = page.locator('#contrat canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 25, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 70, box.y + 65, { steps: 8 })
  await page.mouse.move(box.x + 130, box.y + 30, { steps: 8 })
  await page.mouse.up()
}

test('la signature exige nom, accord et dessin puis permet de corriger un échec réseau', async ({ page }) => {
  const backend = await installerBackendArtisan(page, { signe: false })
  let appels = 0
  let panne = true
  await page.route('https://crm-test.supabase.co/rest/v1/rpc/signer_contrat', async route => {
    appels++
    const payload = route.request().postDataJSON()
    expect(payload.p_signataire).toBe('Artisan Fictif')
    expect(payload.p_signature).toMatch(/^data:image\/png;base64,/)
    if (panne) return route.fulfill({ status: 503, json: { message: 'Panne simulée' } })
    backend.espace.signe = true
    backend.espace.engagement.statut = 'signe'
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(URL_ARTISAN_DEMO)
  const signer = page.getByRole('button', { name: 'Signer le contrat', exact: true })
  await signer.click()
  await expect(page.getByText('Indiquez votre nom', { exact: true })).toBeVisible()
  await page.getByLabel('Nom du signataire').fill('Artisan Fictif')
  await signer.click()
  await expect(page.getByText('Vous devez cocher « Lu et approuvé »')).toBeVisible()
  await page.getByRole('checkbox').check()
  await signer.click()
  await expect(page.getByText('Signez dans le cadre', { exact: true })).toBeVisible()
  expect(appels).toBe(0)
  await dessiner(page)
  await page.getByRole('button', { name: 'Effacer', exact: true }).click()
  await signer.click()
  expect(appels).toBe(0)
  await dessiner(page)
  await signer.click()
  await expect(page.getByText('Connexion impossible : réessayez dans un instant.')).toBeVisible()
  await expect(page.getByLabel('Nom du signataire')).toHaveValue('Artisan Fictif')
  await expect(page.getByRole('checkbox')).toBeChecked()
  expect(appels).toBe(1)
  panne = false
  await signer.click()
  await expect.poll(() => appels).toBe(2)
  await expect(signer).toHaveCount(0)
  await expect(page.locator('body')).toContainText('Sophie Laurent')
  expect(backend.requetesNonSimulees).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
})

test('le refus métier du contrat conserve la signature et explique le blocage', async ({ page }) => {
  await installerBackendArtisan(page, { signe: false })
  await page.route('https://crm-test.supabase.co/rest/v1/rpc/signer_contrat', route => route.fulfill({ json: { ok: false, error: 'artisan_ecarte' } }))
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByLabel('Nom du signataire').fill('Artisan Fictif')
  await page.getByRole('checkbox').check()
  await dessiner(page)
  await page.getByRole('button', { name: 'Signer le contrat', exact: true }).click()
  await expect(page.getByText('Ce contrat n’est plus disponible. Contactez Celexia.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Signer le contrat', exact: true })).toBeEnabled()
  await expect(page.locator('body')).not.toContainText('Sophie Laurent')
})

test('aide et coordonnées ouvrent les bons canaux sans émission automatique', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(`${URL_ARTISAN_DEMO}?vue=aide`)
  await expect(page.locator('footer a[href^="tel:"]')).toHaveCount(1)
  await expect(page.locator('footer a[href^="mailto:"]')).toHaveAttribute('href', 'mailto:agence.celexia@gmail.com')
  expect(backend.mutations).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
  expect(backend.erreursPage).toEqual([])
})
