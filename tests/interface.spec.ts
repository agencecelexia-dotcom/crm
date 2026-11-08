import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installerBackend } from './helpers/interface-backend'

// Cette suite ne doit jamais employer la configuration/API réelle du CRM.
test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.config.metadata.isolatedInterface !== true, 'Utiliser --config tests/interface.config.ts pour le backend fictif')
  page.setDefaultTimeout(10_000)
})

async function sansDebordement(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    ecran: document.documentElement.clientWidth,
  }))).toEqual(await page.evaluate(() => ({ document: document.documentElement.clientWidth, ecran: document.documentElement.clientWidth })))
}

async function capture(page: Page, testInfo: TestInfo, nom: string, fullPage = true) {
  const dossier = resolve('test-results/review')
  await mkdir(dossier, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: resolve(dossier, `${nom}-${testInfo.project.name}.png`), fullPage, animations: 'disabled' })
}

test('la navigation donne accès aux modules et suit les sous-pages', async ({ page, isMobile }) => {
  const backend = await installerBackend(page)
  await page.goto('/projets')
  await expect(page.getByRole('heading', { name: 'Projets', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nouveau projet', exact: true })).toBeVisible()
  if (isMobile) {
    await page.getByRole('button', { name: 'Ouvrir toute la navigation' }).click()
    const menu = page.getByRole('dialog', { name: 'Navigation' })
    await expect(menu.getByRole('link', { name: 'Commissions', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Automatisations', exact: true })).toHaveCount(1)
    await expect(menu.getByRole('link', { name: 'Équipe', exact: true })).toHaveCount(1)
    await expect(menu.getByRole('link', { name: 'Métrés à vérifier', exact: true })).toHaveCount(1)
    await menu.getByRole('link', { name: 'Artisans', exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(page).toHaveURL(/\/artisans$/)
  } else {
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Artisans', exact: true }).click()
    await expect(page).toHaveURL(/\/artisans$/)
  }
  await page.goto('/projets/corbeille')
  await expect(page.getByRole('heading', { name: 'Corbeille', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Projets', exact: true })).toHaveAttribute('aria-current', 'page')
  await sansDebordement(page)
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
})

test('la navigation commerciale masque les modules fondateur', async ({ page, isMobile }) => {
  const backend = await installerBackend(page, { role: 'commercial' })
  await page.goto('/projets')
  await expect(page.getByText('Sophie Laurent', { exact: true })).toBeVisible()
  const menu = isMobile ? page.getByRole('dialog', { name: 'Navigation' }) : page.getByRole('navigation', { name: 'Navigation principale' })
  if (isMobile) await page.getByRole('button', { name: 'Ouvrir toute la navigation' }).click()
  await expect(menu.getByRole('link', { name: 'Mes reprises', exact: true })).toHaveCount(1)
  await expect(menu.getByRole('link', { name: 'Artisans', exact: true })).toHaveCount(1)
  await expect(menu.getByRole('link', { name: 'Commissions', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Équipe', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nouveau projet', exact: true })).toHaveCount(0)
  expect(backend.erreursPage).toEqual([])
})

test('un commercial sans droit ne peut pas ouvrir une création ni monter la transcription', async ({ page }) => {
  const backend = await installerBackend(page, { role: 'commercial' })
  await page.addInitScript(() => {
    const appels = { lecturesMoteur: 0, micro: 0, reconnaissance: 0 }
    Object.assign(window, { __appelTest: appels })
    const lire = Storage.prototype.getItem
    Storage.prototype.getItem = function (cle: string) {
      // La préférence n'est lue que lors du montage de l'écran autorisé.
      if (cle === 'crm.appel.moteur') appels.lecturesMoteur++
      return lire.call(this, cle)
    }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { appels.micro++; throw new Error('Micro interdit dans les tests') },
    })
    class ReconnaissanceInterdite {
      constructor() { appels.reconnaissance++; throw new Error('Reconnaissance interdite dans les tests') }
    }
    Object.assign(window, { SpeechRecognition: ReconnaissanceInterdite, webkitSpeechRecognition: ReconnaissanceInterdite })
  })
  for (const [route, message] of [
    ['/appel', 'Prise d’appel non autorisée'],
    ['/projets/new', 'Création non autorisée'],
  ]) {
    await page.goto(route)
    await expect(page.getByText(message, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Créer le projet', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __appelTest: object }).__appelTest))
      .toEqual({ lecturesMoteur: 0, micro: 0, reconnaissance: 0 })
  }
  expect(backend.appelsFonctions).toEqual([])
  expect(backend.creationsProjets).toEqual([])
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
})

test('la modale reste utilisable à petite hauteur et Entrée soumet une seule requête', async ({ page }, testInfo) => {
  const backend = await installerBackend(page, { refuserCreation: true })
  await page.setViewportSize({ width: 375, height: 600 })
  await page.goto('/projets')
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click()
  const modale = page.getByRole('dialog', { name: 'Nouveau projet', exact: true })
  const telephone = modale.getByRole('textbox', { name: 'Téléphone *', exact: true })
  const ajouter = modale.getByRole('button', { name: 'Ajouter', exact: true })
  await expect(telephone).toBeFocused()
  await telephone.fill('0600000099')
  await ajouter.scrollIntoViewIfNeeded()
  await expect(ajouter).toBeInViewport()
  const boite = await modale.boundingBox()
  expect(boite).not.toBeNull()
  expect(boite!.y).toBeGreaterThanOrEqual(0)
  expect(boite!.y + boite!.height).toBeLessThanOrEqual(600)
  await sansDebordement(page)
  await expect.poll(() => modale.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await capture(page, testInfo, 'nouveau-projet-375', false)
  await telephone.press('Enter')
  await expect(page.getByText('Ajout impossible', { exact: true })).toBeVisible()
  expect(backend.creationsProjets).toHaveLength(1)
  expect(backend.creationsProjets[0]).toMatchObject({ client_telephone: '0600000099', statut: 'a_rappeler' })
  await expect(modale).toBeVisible()
  await expect(telephone).toHaveValue('0600000099')
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
})

test('les filtres artisans survivent au retour et se réinitialisent', async ({ page, isMobile }) => {
  const backend = await installerBackend(page)
  await page.goto('/artisans')
  await expect(page.getByRole('heading', { name: 'Artisans', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Rechercher un artisan' }).fill('Martin')
  if (isMobile) {
    await page.getByRole('button', { name: /^Filtres/ }).click()
    await expect(page.getByRole('button', { name: /^Filtres/ })).toHaveAttribute('aria-expanded', 'true')
  }
  await page.getByRole('combobox', { name: 'Filtrer par métier' }).click()
  await page.getByRole('option', { name: 'Couverture', exact: true }).click()
  await page.getByRole('combobox', { name: 'Filtrer par provenance' }).click()
  await page.getByRole('option', { name: "Ajoutés par l'agence", exact: true }).click()
  await expect(page).toHaveURL(/q=Martin/)
  await expect(page).toHaveURL(/metier=Couverture/)
  await expect(page).toHaveURL(/source=agence/)
  await page.getByRole('link').filter({ hasText: 'Julien Martin' }).click()
  await expect(page.getByRole('heading', { name: 'Martin Julien', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retour', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Rechercher un artisan' })).toHaveValue('Martin')
  if (isMobile) await page.getByRole('button', { name: /^Filtres/ }).click()
  await expect(page.getByRole('combobox', { name: 'Filtrer par métier' })).toContainText('Couverture')
  await expect(page.getByRole('combobox', { name: 'Filtrer par provenance' })).toContainText("Ajoutés par l'agence")
  await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click()
  await expect(page).toHaveURL(/\/artisans$/)
  await expect(page.getByRole('textbox', { name: 'Rechercher un artisan' })).toHaveValue('')
  await expect(page.getByRole('link').filter({ hasText: 'Camille Bernard' })).toBeVisible()
  await sansDebordement(page)
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
})

test('une erreur de chargement ne se présente pas comme une base vide', async ({ page }) => {
  const backend = await installerBackend(page, { projetsEnErreur: true })
  await page.goto('/projets')
  await expect(page.getByText('Impossible de charger les projets', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toBeVisible()
  await expect(page.getByText('Aucun projet', { exact: true })).toHaveCount(0)
  expect(backend.erreursPage).toEqual([])
})

test('une liste réellement vide conserve son invitation à créer', async ({ page }) => {
  await installerBackend(page, { projetsVides: true })
  await page.goto('/projets')
  await expect(page.getByText('Aucun projet', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Nouveau projet', exact: true })).toBeVisible()
  await expect(page.getByText('Impossible de charger les projets', { exact: true })).toHaveCount(0)
})

test('la connexion conserve la destination et ses filtres', async ({ page }, testInfo) => {
  const backend = await installerBackend(page, { connecte: false })
  await page.goto('/artisans?q=Martin')
  await expect(page).toHaveURL(/\/login$/)
  await sansDebordement(page)
  await capture(page, testInfo, 'connexion')
  await page.getByLabel('Email', { exact: true }).fill('test@celexia.example')
  await page.getByLabel('Mot de passe', { exact: true }).fill('mot-de-passe-fictif')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page).toHaveURL(/\/artisans\?q=Martin$/)
  await expect(page.getByRole('textbox', { name: 'Rechercher un artisan' })).toHaveValue('Martin')
  await expect(page.getByRole('link').filter({ hasText: 'Julien Martin' })).toBeVisible()
  expect(backend.erreursPage).toEqual([])
})

test('les listes et le tableau de bord restent lisibles sans débordement', async ({ page, isMobile }, testInfo) => {
  const backend = await installerBackend(page)
  await page.goto('/projets')
  await expect(page.getByText('Sophie Laurent', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nouveau projet', exact: true })).toBeVisible()
  await sansDebordement(page)
  await capture(page, testInfo, 'projets')
  await page.goto('/artisans')
  await expect(page.getByRole('link').filter({ hasText: 'Julien Martin' })).toBeVisible()
  await sansDebordement(page)
  await capture(page, testInfo, 'artisans')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Tableau de bord', exact: true })).toBeVisible()
  await expect(page.locator('dt').filter({ hasText: /^CA signé$/ })).toBeVisible()
  await expect(page.locator('dd').filter({ hasText: /^45\s600\s€$/ })).toBeVisible()
  await expect(page.locator('.recharts-surface').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('500 16px "Plus Jakarta Sans"') && document.fonts.check('500 32px "Clash Display"'))).toBe(true)
  if (!isMobile) {
    const graphique = await page.locator('.recharts-surface').first().boundingBox()
    expect(graphique).not.toBeNull()
    expect(graphique!.y + graphique!.height).toBeLessThan(1000)
  }
  await sansDebordement(page)
  await capture(page, testInfo, 'tableau-de-bord')
  await capture(page, testInfo, 'tableau-de-bord-premier-ecran', false)
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/projets')
    await expect(page.getByText('Sophie Laurent', { exact: true })).toBeVisible()
    await sansDebordement(page)
    await capture(page, testInfo, 'projets-320')
  }
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
})
