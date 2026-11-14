import { expect, test } from '@playwright/test'
import { installerBackend, liensInscription } from './helpers/interface-backend'

const lien = liensInscription.find((l) => l.canal === 'email' && l.taux === 20)!

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
  const backend = await installerBackend(page, { connecte: false })
  await page.route('https://nominatim.openstreetmap.org/search?*', (r) => r.fulfill({ json: [{ lat: '45.76', lon: '4.84' }] }))
  await page.route('**/rest/v1/rpc/lien_inscription_artisan', async (r) => {
    expect(r.request().postDataJSON()).toEqual({ p_token: lien.token })
    await r.fulfill({ json: { ok: true, taux: 20, canal: 'email' } })
  })
  const inscriptions: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/inscrire_artisan', async (r) => {
    inscriptions.push(r.request().postDataJSON().p_payload)
    await r.fulfill({ json: { ok: true, contrat_token: 'contrat-fictif', taux_commission: 0.20 } })
  })
  await page.goto(`/rejoindre/${lien.token}?taux=10`)
  await expect(page.getByRole('heading', { name: 'Devenez partenaire Celexia' })).toBeVisible()
  for (const [name, value] of [
    ['Nom *', 'Durand'], ['Prénom', 'Sam'], ['Société', 'Atelier fictif'],
    ['Téléphone', '0600000000'], ['Email', 'fictif@example.test'], ['Adresse', '1 rue fictive'],
    ['Code postal', '69001'], ['Ville', 'Lyon'], ['SIREN', '000000000'],
  ]) await page.getByRole('textbox', { name, exact: true }).fill(value)
  await page.getByRole('button', { name: 'Peinture', exact: true }).click()
  await page.getByRole('button', { name: 'Départements', exact: true }).click()
  await page.getByRole('combobox').filter({ hasText: 'Choisir un département…' }).click()
  await page.getByRole('option', { name: /69.*Rhône/ }).click()
  await page.getByRole('button', { name: '+ Ajouter', exact: true }).last().click()
  await page.getByRole('button', { name: 'Continuer →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pourquoi un contrat ?' })).toBeVisible()
  await expect(page.getByText(/fixe notre commission de 20 %/)).toBeVisible()
  expect(inscriptions).toHaveLength(1)
  expect(inscriptions[0].invitation_token).toBe(lien.token)
  expect(inscriptions[0]).toMatchObject({ latitude: 45.76, longitude: 4.84 })
  expect(inscriptions[0]).not.toHaveProperty('taux_commission')
  expect(inscriptions[0]).not.toHaveProperty('source')
  expect(backend.requetesNonSimulees).toEqual([])
  expect(backend.erreursPage).toEqual([])
})

test('un lien modifié, ancien ou incomplet ne donne pas de formulaire', async ({ page }) => {
  await installerBackend(page, { connecte: false })
  await page.route('**/rest/v1/rpc/lien_inscription_artisan', (r) => r.fulfill({ json: { ok: false, error: 'lien_invalide' } }))
  for (const path of ['/rejoindre/email?taux=10', '/rejoindre?taux=10', `/rejoindre/${'0'.repeat(64)}`]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Demandez un nouveau lien' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuer →' })).toHaveCount(0)
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
  await expect(page.getByRole('button', { name: 'Continuer →' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Devenez partenaire Celexia' })).toBeVisible()
})
