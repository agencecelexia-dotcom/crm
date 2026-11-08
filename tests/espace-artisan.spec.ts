import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installerBackendArtisan, TOKEN_ARTISAN_DEMO, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.config.metadata.isolatedInterface !== true, 'Utiliser tests/interface.config.ts : aucune API réelle ne doit être appelée')
  page.setDefaultTimeout(10_000)
})

const vues = [
  ['chantiers', 'Mes chantiers'], ['devis', 'Mes devis'], ['metres', 'Métrés'],
  ['commissions', 'Commissions'], ['entreprise', 'Mon entreprise'], ['aide', 'Aide et contact'],
] as const

function verifierBackend(backend: Awaited<ReturnType<typeof installerBackendArtisan>>) {
  expect(backend.erreursPage, 'Aucune exception dans le navigateur').toEqual([])
  expect(backend.requetesNonSimulees, 'Toutes les API sont explicitement simulées').toEqual([])
  expect(backend.sortiesBloquees, 'Aucune dépendance à un service externe').toEqual([])
  expect(backend.appels.filter((a) => a.nom === 'get_espace_artisan').every((a) => a.payload.p_token === TOKEN_ARTISAN_DEMO)).toBe(true)
}

async function sansDebordement(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function capturer(page: Page, testInfo: TestInfo, nom: string, fullPage = true) {
  const dossier = resolve('test-results/artisan-review')
  await mkdir(dossier, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: resolve(dossier, `${nom}-${testInfo.project.name}.png`), fullPage, animations: 'disabled' })
}

async function navigation(page: Page, isMobile: boolean) {
  if (!isMobile) return page.getByRole('navigation', { name: 'Navigation de l’espace artisan' })
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click()
  return page.getByRole('dialog', { name: 'Votre espace artisan', exact: true })
}

async function aller(page: Page, isMobile: boolean, nom: string) {
  const menu = await navigation(page, isMobile)
  await menu.getByRole('button', { name: new RegExp(`^${nom}`) }).click()
  if (isMobile) await expect(menu).toBeHidden()
}

test('les six écrans sont accessibles et le retour conserve la navigation de l’espace', async ({ page, isMobile }, testInfo) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(URL_ARTISAN_DEMO)
  await expect(page.getByRole('searchbox', { name: 'Rechercher un chantier' })).toBeVisible()
  for (const [vue, titre] of vues) {
    await aller(page, isMobile, titre)
    await expect.poll(() => new URL(page.url()).searchParams.get('vue') ?? 'chantiers').toBe(vue)
    const menu = await navigation(page, isMobile)
    await expect(menu.getByRole('button', { name: new RegExp(`^${titre}`) })).toHaveAttribute('aria-current', 'page')
    if (isMobile) await menu.getByRole('button', { name: 'Fermer', exact: true }).click()
    if (vue === 'devis') await expect(page.getByText(/DEV-2026-014/)).toBeVisible()
    if (vue === 'metres') await expect(page.getByRole('button', { name: /Sophie Laurent/ })).toBeVisible()
    if (vue === 'commissions') await expect(page.getByRole('button', { name: /Exporter.*CSV/ })).toBeVisible()
    if (vue === 'entreprise') await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible()
    if (vue === 'aide') await expect(page.getByRole('heading', { name: 'Comment fonctionne votre espace', exact: true })).toBeVisible()
    await sansDebordement(page)
    await capturer(page, testInfo, vue)
    if (vue === 'chantiers') await capturer(page, testInfo, 'chantiers-premier-ecran', false)
  }
  await page.goBack()
  await expect(page).toHaveURL(/vue=entreprise/)
  await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/vue=commissions/)
  await page.reload()
  await expect(page.getByRole('button', { name: /Exporter.*CSV/ })).toBeVisible()
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 720 })
    for (const [vue, titre] of vues) {
      await aller(page, true, titre)
      await expect(page.getByRole('heading', { name: titre, exact: true, level: 1 })).toBeVisible()
      await sansDebordement(page)
      await capturer(page, testInfo, `${vue}-320`)
    }
  }
  verifierBackend(backend)
})

test('la recherche et les filtres isolent les bons chantiers puis le panneau permet de répondre', async ({ page }, testInfo) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(URL_ARTISAN_DEMO)
  const recherche = page.getByRole('searchbox', { name: 'Rechercher un chantier' })
  await recherche.fill('Villeurbanne')
  await expect(page.getByText('Pierre Moreau', { exact: true })).toBeVisible()
  await expect(page.getByText('Sophie Laurent', { exact: true })).toHaveCount(0)
  await recherche.fill('introuvable-demo')
  await expect(page.getByText(/Aucun chantier.*recherche/)).toBeVisible()
  await recherche.fill('')
  await page.getByRole('button', { name: /^Devis envoyé\s/ }).click()
  await expect(page.getByText('Nicolas Petit', { exact: true })).toBeVisible()
  await expect(page.getByText('Pierre Moreau', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Avant signature\s/ }).click()
  await expect(page.getByText('Pierre Moreau', { exact: true })).toBeVisible()
  await expect(page.getByText('Claire Bonnet', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Antoine Lefèvre', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Tous\s/ }).click()
  await page.getByRole('tab', { name: 'Par étape', exact: true }).click()
  await sansDebordement(page)
  await page.getByRole('tab', { name: 'Liste', exact: true }).click()
  await recherche.fill('Sophie Laurent')
  await page.getByRole('button', { name: 'Ouvrir le chantier', exact: true }).click()
  const panneau = page.getByRole('dialog', { name: 'Sophie Laurent', exact: true })
  await expect(panneau).toBeVisible()
  await expect(panneau.getByRole('link', { name: /06\s?00\s?00\s?01\s?00/ })).toBeVisible()
  const note = panneau.getByRole('textbox', { name: 'Note de suivi', exact: true })
  await note.fill('Visite convenue mardi à 17 h, accès par la cour.')
  await panneau.getByRole('button', { name: 'Envoyer la note', exact: true }).click()
  await expect(note).toHaveValue('')
  await expect(panneau.getByText('Visite convenue mardi à 17 h, accès par la cour.', { exact: true })).toBeVisible()
  expect(backend.mutations).toEqual([{ nom: 'add_suivi_by_token', payload: { p_token: 'affectation-demo-1', p_statut: null, p_message: 'Visite convenue mardi à 17 h, accès par la cour.', p_date_rdv: null, p_motif: null, p_cle: expect.stringMatching(/^[a-f0-9-]{36}$/) } }])
  await panneau.evaluate((element) => { element.scrollTop = 0 })
  await capturer(page, testInfo, 'chantier-panneau', false)
  await panneau.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(panneau).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Liste', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(recherche).toHaveValue('Sophie Laurent')
  verifierBackend(backend)
})

test('une liste de devis vide explique comment commencer', async ({ page }, testInfo) => {
  const backend = await installerBackendArtisan(page, { devisVides: true })
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await expect(page.getByText('Votre premier devis commence ici', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nouveau devis', exact: true })).toBeEnabled()
  await capturer(page, testInfo, 'devis-vide')
  verifierBackend(backend)
})

test('une panne de devis se distingue du vide et se récupère sans recharger', async ({ page }) => {
  const backend = await installerBackendArtisan(page, { devisEnErreur: true })
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await expect(page.getByText(/Impossible de charger.*devis|devis.*indisponibles/i)).toBeVisible()
  await expect(page.getByText('Votre premier devis commence ici', { exact: true })).toHaveCount(0)
  backend.etat.devisEnErreur = false
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByText(/DEV-2026-014/)).toBeVisible()
  verifierBackend(backend)
})

test('une vérification des assurances indisponible ne les présente pas comme manquantes', async ({ page }, testInfo) => {
  const backend = await installerBackendArtisan(page, { chiffrageEnErreur: true })
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await expect(page.getByText('L’accès aux devis n’a pas pu être vérifié', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nouveau devis', exact: true })).toHaveCount(0)
  await expect(page.getByText(/Déposez votre attestation décennale/)).toHaveCount(0)
  await capturer(page, testInfo, 'devis-indisponible')
  verifierBackend(backend)
})

test('la fiche entreprise reste éditable et les assurances validées sont explicites', async ({ page }, testInfo) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(`${URL_ARTISAN_DEMO}?vue=entreprise`)
  await expect(page.getByText('Responsabilité décennale', { exact: true })).toBeVisible()
  await expect(page.getByText('Responsabilité civile professionnelle', { exact: true })).toBeVisible()
  await expect(page.getByText('Chiffrage activé', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  const panneau = page.getByRole('dialog')
  const ville = panneau.getByRole('textbox', { name: 'Ville', exact: true })
  await ville.fill('Villeurbanne')
  const enregistrer = panneau.getByRole('button', { name: 'Enregistrer', exact: true })
  await enregistrer.scrollIntoViewIfNeeded()
  await expect(enregistrer).toBeInViewport()
  await expect.poll(() => panneau.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await capturer(page, testInfo, 'entreprise-formulaire', false)
  await enregistrer.click()
  await expect(panneau).toBeHidden()
  expect(backend.mutations).toHaveLength(1)
  expect(backend.mutations[0]).toMatchObject({ nom: 'enregistrer_identite_by_token', payload: { p_token: TOKEN_ARTISAN_DEMO, p_payload: { ville: 'Villeurbanne' } } })
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Ville', exact: true })).toHaveValue('Villeurbanne')
  verifierBackend(backend)
})

test('les assurances déposées en attente de validation gardent le devis fermé', async ({ page }) => {
  const backend = await installerBackendArtisan(page, { assurancesEnAttente: true })
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await expect(page.getByText('Activez la création de vos devis', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nouveau devis', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Compléter mes assurances', exact: true }).click()
  await expect(page).toHaveURL(/vue=entreprise/)
  expect(backend.appels.filter((a) => a.nom === 'list_devis_by_token').length).toBeGreaterThan(0)
  verifierBackend(backend)
})

test('le relevé détaille la commission et exporte seulement les données fictives', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(`${URL_ARTISAN_DEMO}?vue=commissions`)
  await expect(page.getByText('Claire Bonnet', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Antoine Lefèvre', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Reste à régler', { exact: true })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exporter.*CSV/ }).click(),
  ])
  const fichier = await download.path()
  expect(fichier).not.toBeNull()
  const csv = await readFile(fichier!, 'utf8')
  expect(csv).toContain('Claire Bonnet')
  expect(csv).toMatch(/"24800";"15\s*%";"3720";"non"/)
  expect(csv).toMatch(/"12600";"15\s*%";"1890";"oui"/)
  await sansDebordement(page)
  verifierBackend(backend)
})

test('le générateur de devis reste utilisable et peut être fermé sans enregistrer', async ({ page, isMobile }, testInfo) => {
  const backend = await installerBackendArtisan(page)
  if (isMobile) await page.setViewportSize({ width: 375, height: 600 })
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await page.getByRole('button', { name: 'Nouveau devis', exact: true }).click()
  const panneau = page.getByRole('dialog', { name: 'Créer un devis', exact: true })
  await expect(panneau).toBeVisible()
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Sophie Laurent')
  await panneau.getByRole('textbox', { name: 'Objet du devis', exact: true }).fill('Réfection de couverture')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Dépose et remplacement de tuiles')
  await sansDebordement(page)
  await expect.poll(() => panneau.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const fermer = panneau.getByRole('button', { name: 'Fermer', exact: true }).last()
  await expect(fermer).toBeInViewport()
  await capturer(page, testInfo, 'devis-generateur', false)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Abandonner ce devis')
    await dialog.accept()
  })
  await fermer.click()
  await expect(panneau).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Mes devis', exact: true, level: 1 })).toBeVisible()
  expect(backend.mutations).toEqual([])
  verifierBackend(backend)
})

test('un relevé vide est annoncé et une erreur ne devient pas un total nul', async ({ page }) => {
  const backend = await installerBackendArtisan(page, { commissionsVides: true })
  await page.goto(`${URL_ARTISAN_DEMO}?vue=commissions`)
  await expect(page.getByText('Aucun chantier signé à afficher dans le relevé')).toBeVisible()
  backend.etat.commissionsEnErreur = true
  await page.reload()
  await expect(page.getByText(/Impossible de charger le relevé/)).toBeVisible()
  await expect(page.getByText('Aucun chantier signé à afficher dans le relevé')).toHaveCount(0)
  verifierBackend(backend)
})

test('un lien invalide est distinct d’une coupure réseau et la connexion peut être rétablie', async ({ page }, testInfo) => {
  const backend = await installerBackendArtisan(page, { espaceEnErreur: true })
  await page.goto(URL_ARTISAN_DEMO)
  await expect(page.getByText('Connexion impossible', { exact: true })).toBeVisible()
  await expect(page.getByText('Espace introuvable', { exact: true })).toHaveCount(0)
  await capturer(page, testInfo, 'connexion-impossible')
  backend.etat.espaceEnErreur = false
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Rechercher un chantier' })).toBeVisible()
  backend.etat.lienInvalide = true
  await page.reload()
  await expect(page.getByText('Espace introuvable', { exact: true })).toBeVisible()
  await expect(page.getByText('Connexion impossible', { exact: true })).toHaveCount(0)
  await capturer(page, testInfo, 'lien-invalide')
  verifierBackend(backend)
})

test('avant signature aucune vue ne révèle l’identité client ni ne charge ses devis et commissions', async ({ page }, testInfo) => {
  const backend = await installerBackendArtisan(page, { signe: false })
  for (const [vue] of vues) {
    await page.goto(`${URL_ARTISAN_DEMO}?vue=${vue}`)
    await expect(page.getByRole('button', { name: 'Signer le contrat', exact: true })).toBeVisible()
    for (const secret of ['Sophie Laurent', 'client-0@example.test', '12 rue des Ateliers', 'DEV-2026-014']) {
      await expect(page.locator('body')).not.toContainText(secret)
    }
    await expect(page.locator('a[href="tel:0600000100"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nouveau devis', exact: true })).toHaveCount(0)
    await sansDebordement(page)
  }
  await capturer(page, testInfo, 'avant-signature')
  expect(backend.appels.filter((a) => ['list_devis_by_token', 'identite_by_token', 'releve_commissions_by_token', 'etats_metrage_by_token'].includes(a.nom))).toEqual([])
  expect(backend.mutations).toEqual([])
  verifierBackend(backend)
})
