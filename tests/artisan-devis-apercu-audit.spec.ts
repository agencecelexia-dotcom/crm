import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'Serveur et API isolés requis')
  page.setDefaultTimeout(10_000)
})

async function ouvrirDevis(page: Page) {
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await page.getByRole('button', { name: 'Nouveau devis', exact: true }).click()
  const formulaire = page.getByRole('dialog', { name: 'Créer un devis', exact: true })
  await formulaire.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client aperçu fictif')
  await formulaire.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Pose de couverture fictive')
  await formulaire.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('100')
  return formulaire
}

async function verifierCanvas(apercu: Locator) {
  await expect(apercu.locator('canvas')).toBeVisible()
  await expect(apercu.locator('canvas')).toHaveCount(1)
  expect(await apercu.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let noirs = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) noirs++
    return noirs
  }), 'Le PDF contient un véritable rendu de texte').toBeGreaterThan(100)
}

test('APERCU-01 lit, télécharge puis corrige le devis sans sauvegarde ni perte de saisie', async ({ page }, info) => {
  const backend = await installerBackendArtisan(page)
  const telechargements: string[] = []
  page.on('download', (download) => telechargements.push(download.suggestedFilename()))
  const formulaire = await ouvrirDevis(page)
  await formulaire.getByRole('button', { name: 'Aperçu', exact: true }).click()
  const apercu = page.getByRole('dialog', { name: 'Aperçu du devis', exact: true })
  await verifierCanvas(apercu)
  expect(telechargements).toEqual([])
  expect(backend.mutations).toEqual([])
  await expect(apercu.getByRole('article', { name: 'Texte de la page 1' })).toContainText('Pose de couverture fictive')
  await expect(apercu.getByRole('article', { name: 'Texte de la page 1' })).toContainText('110,00 €')
  await apercu.getByRole('button', { name: 'Agrandir le zoom', exact: true }).click()
  await verifierCanvas(apercu)
  await expect(apercu.getByRole('button', { name: '125 %', exact: true })).toBeVisible()
  await apercu.getByRole('button', { name: '125 %', exact: true }).click()
  await verifierCanvas(apercu)
  const viewport = apercu.getByRole('region', { name: 'Document PDF' })
  expect(await viewport.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await apercu.getByRole('button', { name: 'Afficher le texte', exact: true }).click()
  await expect(apercu.getByRole('article')).toBeVisible()
  await expect(apercu.locator('canvas')).toBeHidden()
  expect(await viewport.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await apercu.getByRole('button', { name: 'Afficher le document', exact: true }).click()
  await page.screenshot({ path: info.outputPath('apercu-devis.png'), fullPage: true })

  const url = await apercu.getByRole('link', { name: 'Télécharger', exact: true }).getAttribute('href')
  const [download] = await Promise.all([page.waitForEvent('download'), apercu.getByRole('link', { name: 'Télécharger', exact: true }).click()])
  expect(download.suggestedFilename()).toBe('devis-APERÇU.pdf')
  await download.saveAs(info.outputPath('devis-court-fictif.pdf'))
  expect((await readFile((await download.path())!)).subarray(0, 5).toString()).toBe('%PDF-')
  await page.keyboard.press('Escape')
  await expect(apercu).toBeHidden()
  await expect(formulaire.getByRole('button', { name: 'Aperçu', exact: true })).toBeFocused()
  await expect(formulaire.getByRole('textbox', { name: 'Nom', exact: true })).toHaveValue('Client aperçu fictif')
  expect(await page.evaluate(async (url) => { try { await fetch(url!); return false } catch { return true } }, url), 'Le Blob URL est libéré à la fermeture').toBe(true)
  await formulaire.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('200')
  await formulaire.getByRole('button', { name: 'Aperçu', exact: true }).click()
  await verifierCanvas(apercu)
  await expect(apercu.getByRole('article', { name: 'Texte de la page 1' })).toContainText('220,00 €')
  await apercu.getByRole('button', { name: 'Revenir au devis', exact: true }).click()
  await expect(formulaire.getByRole('textbox', { name: 'Prix unitaire', exact: true })).toHaveValue('200')
  expect(telechargements).toHaveLength(1)
  expect(backend.mutations).toEqual([])
  expect(backend.erreursPage).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
})

test('APERCU-02 le devis long pagine sans perdre les textes, totaux, CGV ni signature', async ({ page }, info) => {
  const backend = await installerBackendArtisan(page)
  await page.route('https://crm-test.supabase.co/rest/v1/rpc/identite_by_token', (route) => route.fulfill({ json: {
    societe: 'Entreprise fictive de couverture et rénovation '.repeat(12) + 'SOCIETE_FIN',
    adresse: 'Adresse fictive et complément de localisation '.repeat(20) + 'ENTREPRISE_FIN',
    ville: 'Lyon', code_postal: '69003', siren: '000000000', logo_url: null,
    cgv: '1. Article de démonstration\nLes dispositions fictives précisent les engagements et les conditions de réalisation.\n\n'.repeat(90) + 'CGV_FIN',
    manquants: [], tva_mode_defaut: 'normal', acompte_defaut: 30, assurance: {},
  } }))
  await page.route('https://crm-test.supabase.co/rest/v1/rpc/devis_by_token', (route) => route.fulfill({ json: { ok: true, devis: {
    id: 'devis-demo-2', numero: 'DEV-2026-015', revision: 1, statut: 'brouillon',
    client_nom: 'Client au nom long '.repeat(12) + 'CLIENT_FIN',
    client_adresse: 'Adresse et indications de chantier fictives '.repeat(22) + 'ADRESSE_FIN',
    client_email: 'fictif@example.test', objet: 'Rénovation complète avec détail des interventions '.repeat(35) + 'OBJET_FIN',
    conditions: 'Les conditions de chantier détaillent les étapes et délais convenus. '.repeat(100) + 'CONDITIONS_FIN',
    acompte_pct: 30, tva_mode: 'normal',
    lignes: [
      { designation: 'Dépose et remplacement de la couverture, protections et finitions. '.repeat(160) + 'DESIGNATION_FIN', quantite: 1, unite: 'u', prix_unitaire: 100, tva_taux: 10 },
      ...Array.from({ length: 45 }, (_, i) => ({ designation: `Prestation complémentaire ${i + 1}`, quantite: 2, unite: 'm²', prix_unitaire: 10, tva_taux: i % 2 ? 20 : 10 })),
    ],
  } } }))
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await page.getByRole('button', { name: /Reprendre.*DEV-2026-015/ }).click()
  const formulaire = page.getByRole('dialog', { name: 'Modifier le devis DEV-2026-015' })
  await formulaire.getByRole('button', { name: 'Aperçu', exact: true }).click()
  const apercu = page.getByRole('dialog', { name: 'Aperçu du devis', exact: true })
  await verifierCanvas(apercu)
  const nombrePages = await apercu.getByRole('combobox', { name: 'Page affichée' }).locator('option').count()
  expect(nombrePages).toBeGreaterThan(6)
  await page.screenshot({ path: info.outputPath('apercu-long-premiere-page.png'), fullPage: true })
  await apercu.getByRole('button', { name: 'Page suivante', exact: true }).click()
  await verifierCanvas(apercu)
  await page.screenshot({ path: info.outputPath('apercu-long-suite.png'), fullPage: true })
  await apercu.getByRole('combobox', { name: 'Page affichée' }).selectOption(String(nombrePages))
  await verifierCanvas(apercu)
  await expect(apercu.getByRole('article')).toContainText('bon pour accord')
  await expect(apercu.getByRole('button', { name: 'Page suivante', exact: true })).toBeDisabled()
  await page.screenshot({ path: info.outputPath('apercu-long-signature.png'), fullPage: true })
  const [download] = await Promise.all([page.waitForEvent('download'), apercu.getByRole('link', { name: 'Télécharger', exact: true }).click()])
  await download.saveAs(info.outputPath('devis-long-fictif.pdf'))
  const bytes = (await readFile((await download.path())!)).toString('base64')
  // Analyse de toutes les pages par le vrai parseur du navigateur, sans mock
  // de jsPDF ni de PDF.js. Vérifie les coordonnées physiques du texte imprimé.
  const analyse = await page.evaluate(async (base64) => {
    const moduleUrl = '/node_modules/pdfjs-dist/build/pdf.mjs'
    const pdfjs = await import(/* @vite-ignore */ moduleUrl)
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
    const chargement = pdfjs.getDocument({ data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) })
    const doc = await chargement.promise
    const pages: string[] = []
    const horsPage: string[] = []
    const images: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const taille = page.getViewport({ scale: 1 })
      const texte = await page.getTextContent()
      const items = texte.items.filter((item: { str?: string }) => item.str?.trim())
      pages.push(items.map((item: { str: string }) => item.str).join(' '))
      for (const item of items) {
        const [,,,, x, y] = item.transform
        if (x < 0 || x + item.width > taille.width + 1 || y < 0 || y > taille.height) horsPage.push(`p${p}: ${item.str}`)
      }
      const rendu = page.getViewport({ scale: 1.4 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(rendu.width)
      canvas.height = Math.ceil(rendu.height)
      await page.render({ canvas, viewport: rendu }).promise
      images.push(canvas.toDataURL('image/png').split(',')[1])
      canvas.width = canvas.height = 0
    }
    await chargement.destroy()
    return { pages, horsPage, images }
  }, bytes)
  for (let i = 0; i < analyse.images.length; i++) await writeFile(info.outputPath(`devis-long-page-${i + 1}.png`), Buffer.from(analyse.images[i], 'base64'))
  expect(analyse.horsPage).toEqual([])
  const texte = analyse.pages.join(' ')
  for (const fin of ['SOCIETE_FIN', 'ENTREPRISE_FIN', 'CLIENT_FIN', 'ADRESSE_FIN', 'OBJET_FIN', 'DESIGNATION_FIN', 'CONDITIONS_FIN', 'CGV_FIN', 'Prestation complémentaire 45', 'TOTAL TTC', 'Conditions générales', 'bon pour accord']) expect(texte).toContain(fin)
  expect(texte.match(/TOTAL TTC/g)).toHaveLength(1)
  expect(texte.match(/1 144,00 €/g)).toHaveLength(1)
  await apercu.getByRole('button', { name: 'Revenir au devis', exact: true }).click()
  await expect(formulaire.getByRole('textbox', { name: 'Prix unitaire', exact: true })).toHaveCount(46)
  expect(backend.mutations).toEqual([])
  expect(backend.erreursPage).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
})

test('APERCU-03 une panne du lecteur laisse le téléchargement et le retour accessibles', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  // Seul le transport du worker échoue. Le générateur PDF reste réel et le
  // repli de PDF.js échoue lui aussi, comme sur une connexion interrompue.
  const formulaire = await ouvrirDevis(page)
  await page.route('**/pdf.worker*.mjs*', (route) => route.abort('failed'))
  await formulaire.getByRole('button', { name: 'Aperçu', exact: true }).click()
  const apercu = page.getByRole('dialog', { name: 'Aperçu du devis', exact: true })
  await expect(apercu.getByRole('alert')).toContainText('L’aperçu n’a pas pu être affiché')
  const [download] = await Promise.all([page.waitForEvent('download'), apercu.getByRole('link', { name: 'Télécharger', exact: true }).click()])
  expect((await readFile((await download.path())!)).subarray(0, 5).toString()).toBe('%PDF-')
  await expect(apercu.getByRole('button', { name: 'Réessayer l’aperçu' })).toBeEnabled()
  await page.unroute('**/pdf.worker*.mjs*')
  await apercu.getByRole('button', { name: 'Réessayer l’aperçu' }).click()
  await verifierCanvas(apercu)
  await apercu.getByRole('button', { name: 'Revenir au devis', exact: true }).click()
  await expect(formulaire.getByRole('textbox', { name: 'Prix unitaire', exact: true })).toHaveValue('100')
  expect(backend.mutations).toEqual([])
  expect(backend.erreursPage).toEqual([])
})

test('APERCU-04 fermer pendant la préparation ne rouvre pas le lecteur et libère le travail abandonné', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  let libererLogo!: () => void
  const attendreLogo = new Promise<void>((resolve) => { libererLogo = resolve })
  await page.route('https://crm-test.supabase.co/rest/v1/rpc/identite_by_token', (route) => route.fulfill({ json: {
    societe: 'Entreprise fictive', ville: 'Lyon', manquants: [], tva_mode_defaut: 'normal', assurance: {},
    logo_url: 'http://127.0.0.1:5180/__audit_logo_attente.png',
  } }))
  await page.route('**/__audit_logo_attente.png', async (route) => {
    await attendreLogo
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQXcAAAAASUVORK5CYII=', 'base64') })
  })
  const formulaire = await ouvrirDevis(page)
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))
  await formulaire.getByRole('button', { name: 'Aperçu', exact: true }).click()
  const apercu = page.getByRole('dialog', { name: 'Aperçu du devis', exact: true })
  await expect(apercu.getByRole('status')).toContainText('Préparation de l’aperçu')
  await apercu.getByRole('button', { name: 'Revenir au devis', exact: true }).click()
  await expect(formulaire.getByRole('textbox', { name: 'Nom', exact: true })).toHaveValue('Client aperçu fictif')
  libererLogo()
  await formulaire.getByRole('button', { name: 'Aperçu', exact: true }).click()
  await verifierCanvas(apercu)
  expect(workers.filter((url) => url.includes('pdf.worker'))).toHaveLength(1)
  await apercu.getByRole('button', { name: 'Revenir au devis', exact: true }).click()
  await expect(apercu).toBeHidden()
  expect(backend.erreursPage).toEqual([])
  expect(backend.mutations).toEqual([])
})
