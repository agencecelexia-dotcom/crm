import { expect, test } from '@playwright/test'
import { installerBackend, projets, liensInscription } from './helpers/interface-backend'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'Backend fictif obligatoire')
  page.setDefaultTimeout(10_000)
})

test('masquer, retrouver par téléphone et restaurer conserve le projet', async ({ page }) => {
  await installerBackend(page)
  const rows = structuredClone(projets).map((p) => ({ ...p, masque_agence_at: null as string | null }))
  await page.route('**/rest/v1/projets?*', (route) => route.fulfill({ json: rows }))
  await page.route('**/rest/v1/rpc/masquer_projet', async (route) => {
    const p = route.request().postDataJSON()
    const row = rows.find((r) => r.id === p.p_projet_id)!
    row.masque_agence_at = p.p_masque ? new Date().toISOString() : null
    await route.fulfill({ json: { ok: true } })
  })
  await page.goto('/projets')
  await page.getByRole('button', { name: 'Masquer Sophie Laurent', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Projets', exact: true }).getByText('Sophie Laurent')).toHaveCount(0)
  await page.getByRole('tab', { name: /Masqués/ }).click()
  await page.getByRole('textbox', { name: 'Rechercher un projet' }).fill(rows[0].client_telephone!)
  await expect(page.getByRole('list', { name: 'Projets', exact: true }).getByText('Sophie Laurent')).toBeVisible()
  await page.getByRole('button', { name: 'Restaurer Sophie Laurent' }).click()
  await page.getByRole('tab', { name: /Pipeline/ }).click()
  await expect(page.getByRole('list', { name: 'Projets', exact: true }).getByText('Sophie Laurent')).toBeVisible()
  expect(rows).toHaveLength(projets.length)
  expect(rows[0].statut).toBe(projets[0].statut)
})

test('Partenaires est la vue par défaut et les artisans restent accessibles', async ({ page }) => {
  const backend = await installerBackend(page)
  await page.goto('/artisans')
  await expect(page.getByRole('tab', { name: /Partenaires/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Robert Rénovation', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: /^Artisans/ }).click()
  await expect(page).toHaveURL(/vue=artisans/)
  await expect(page.getByText('Atelier Martin', { exact: true })).toBeVisible()
  expect(backend.erreursPage).toEqual([])
})

test('invitation email sans nom : aperçu adapté et confirmation réelle requise', async ({ page }) => {
  const backend = await installerBackend(page)
  const envois: Record<string, unknown>[] = []
  await page.route('**/rest/v1/invitations_artisans?*', (r) => r.fulfill({ json: [] }))
  await page.route('**/functions/v1/invitation-artisan', async (r) => {
    envois.push(r.request().postDataJSON())
    await r.fulfill({ json: { ok: true, etat: 'confirme' } })
  })
  await page.goto('/artisans')
  await page.getByRole('button', { name: "Lien d'inscription", exact: true }).click()
  await expect(page.getByText('Leboncoin', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Envoyer 10 %', exact: true }).click()
  await page.getByLabel(/Email destinataire/).fill('test@example.test')
  const apercu = page.frameLocator('iframe[title="Aperçu de l’invitation Celexia"]')
  await expect(apercu.getByText('Bonjour,', { exact: true })).toBeVisible()
  await expect(apercu.getByRole('link', { name: /Compléter mon inscription/ })).toHaveAttribute('href', `https://crm-ci7k.vercel.app/rejoindre/${liensInscription.find((l) => l.canal === 'email' && l.taux === 10)!.token}`)
  await page.getByRole('button', { name: 'Envoyer l’invitation à 10 % via Gmail', exact: true }).click()
  await expect(page.getByText(/Gmail a confirmé la prise en charge/)).toBeVisible()
  expect(envois).toHaveLength(1)
  expect(envois[0]).toMatchObject({ email: 'test@example.test', prenom: '', nom: '', societe: '', taux: 10 })
  expect(backend.erreursPage).toEqual([])
})

test('une réponse email ambiguë ne propose pas de renvoi automatique', async ({ page }) => {
  await installerBackend(page)
  let n = 0
  await page.route('**/rest/v1/invitations_artisans?*', (r) => r.fulfill({ json: [] }))
  await page.route('**/functions/v1/invitation-artisan', async (r) => { n++; await r.fulfill({ json: { ok: false, etat: 'incertain' } }) })
  await page.goto('/artisans')
  await page.getByRole('button', { name: "Lien d'inscription", exact: true }).click()
  await page.getByRole('button', { name: 'Envoyer 20 %', exact: true }).click()
  await page.getByLabel(/Email destinataire/).fill('test@example.test')
  await page.getByRole('button', { name: 'Envoyer l’invitation à 20 % via Gmail', exact: true }).click()
  await expect(page.getByText(/Envoi non confirmé/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Envoyer l’invitation à 20 % via Gmail', exact: true })).toHaveCount(0)
  expect(n).toBe(1)
})

test('les réglages agence enregistrent une réactivation et survivent au rechargement', async ({ page }) => {
  await installerBackend(page)
  const features: Record<string, boolean> = { chantiers: true, devis: false, metres: false, entreprise: true, commissions: true, aide: true }
  await page.route('**/rest/v1/rpc/fonctionnalites_espace_artisan', (r) => r.fulfill({ json: features }))
  await page.route('**/rest/v1/fonctionnalites_artisan?*', async (r) => {
    const cle = new URL(r.request().url()).searchParams.get('cle')!.slice(3)
    features[cle] = r.request().postDataJSON().active
    await r.fulfill({ json: { cle } })
  })
  await page.goto('/parametres/crm-artisan')
  await expect(page.getByRole('switch', { name: 'Mes devis', exact: true })).not.toBeChecked()
  await page.getByRole('switch', { name: 'Mes devis', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Mes devis', exact: true })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Mes devis', exact: true })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Métrés', exact: true })).not.toBeChecked()
})

test('devis et métrés désactivés : navigation et liens directs restent bloqués', async ({ page, isMobile }) => {
  const backend = await installerBackendArtisan(page, { fonctionnalites: { devis: false, metres: false } })
  await page.goto(URL_ARTISAN_DEMO + '?vue=devis')
  await expect(page.getByRole('heading', { name: 'Mes chantiers', exact: true })).toBeVisible()
  await expect(page.getByText(/Cette rubrique est désactivée/)).toBeVisible()
  if (isMobile) await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
  await expect(page.getByRole('button', { name: 'Mes devis', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Métrés', exact: true })).toHaveCount(0)
  await page.goto(URL_ARTISAN_DEMO + '?vue=metres')
  await expect(page.getByRole('heading', { name: 'Mes chantiers', exact: true })).toBeVisible()
  expect(backend.appels.filter((a) => ['list_devis_by_token', 'metres_by_token'].includes(a.nom))).toEqual([])
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
  await page.screenshot({ path: `test-results/artisan-couleurs-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true })
})
