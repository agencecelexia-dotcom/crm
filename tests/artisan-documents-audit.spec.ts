import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

// Toute l'API est simulée. Les scénarios d'échec ne contactent ni stockage,
// ni messagerie, ni base réels et ne signent aucun document.
test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'Serveur et API isolés requis')
  page.setDefaultTimeout(5_000)
})

const rpc = (nom: string) => `https://crm-test.supabase.co/rest/v1/rpc/${nom}`
async function ouvrirDevis(page: Page) {
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await page.getByRole('button', { name: 'Nouveau devis', exact: true }).click()
  const panneau = page.getByRole('dialog', { name: /Créer un devis|Modifier le devis/ })
  await expect(panneau).toBeVisible()
  return panneau
}

test('DOC-01 protège aussi le client et l’objet saisis sans prestation', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif à conserver')
  await panneau.getByRole('textbox', { name: 'Objet du devis', exact: true }).fill('Visite à chiffrer')
  const confirmations: string[] = []
  page.on('dialog', async (dialog) => { confirmations.push(dialog.message()); await dialog.dismiss() })
  await panneau.getByRole('button', { name: 'Fermer', exact: true }).last().click()
  expect(confirmations).toHaveLength(1)
  await expect(panneau).toBeVisible()
  expect(backend.mutations).toEqual([])
})

test('DOC-02 conserve les CGV personnalisées ouvertes sans modification', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const cgv = 'Conditions personnalisées fictives : acompte de 25 %, paiement à 15 jours.'
  await page.route(rpc('identite_by_token'), (route) => route.fulfill({ json: {
    societe: 'Entreprise fictive', ville: 'Lyon', cgv, cgv_personnalisees: true,
    assurance: {}, manquants: [], tva_mode_defaut: 'normal', acompte_defaut: 25,
  } }))
  await page.goto(`${URL_ARTISAN_DEMO}?vue=entreprise`)
  await page.getByRole('button', { name: 'Modifier', exact: true }).click()
  const panneau = page.getByRole('dialog')
  await panneau.getByRole('button', { name: 'Modifier', exact: true }).click()
  await expect(panneau.getByRole('textbox', { name: 'Conditions générales de vente' })).toHaveValue(cgv)
  await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(panneau).toBeHidden()
  const payload = backend.mutations[0].payload.p_payload as Record<string, unknown>
  expect(payload.cgv === undefined || payload.cgv === cgv).toBe(true)
})

test('DOC-03 un échec PDF réutilise le brouillon réservé lors de la nouvelle tentative', async ({ page }) => {
  await installerBackendArtisan(page)
  const creations: Record<string, unknown>[] = []
  await page.route(rpc('creer_devis_by_token'), async (route) => {
    creations.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, id: 'devis-test-reserve', numero: 'DEV-TEST-001', revision: 1 } })
  })
  await page.route(rpc('enregistrer_prix_by_token'), (route) => route.fulfill({ json: { ok: true } }))
  await page.route('https://crm-test.supabase.co/storage/v1/object/**', (route) => route.fulfill({ status: 503, json: { message: 'Stockage fictif indisponible' } }))
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Prestation fictive')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('100')
  for (let i = 0; i < 2; i++) {
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText('Stockage fictif indisponible', { exact: true }).first()).toBeVisible()
    await expect(panneau.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled()
  }
  expect(creations).toHaveLength(2)
  const first = creations[0].p_payload as Record<string, unknown>
  const second = creations[1].p_payload as Record<string, unknown>
  expect(first.idempotency_key, 'La sauvegarde possède une clé persistante').toBeTruthy()
  expect(second.idempotency_key).toBe(first.idempotency_key)
  expect(second.devis_id).toBe('devis-test-reserve')
})

test('DOC-04 refuse un prix négatif avant de réserver un devis', async ({ page }) => {
  await installerBackendArtisan(page)
  let creations = 0
  await page.route(rpc('creer_devis_by_token'), (route) => {
    creations++
    return route.fulfill({ json: { ok: false, error: 'montant_invalide' } })
  })
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Prestation fictive')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('-100')
  await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText(/prix.*négatif|montant.*négatif/i).first()).toBeVisible()
  expect(creations).toBe(0)
})

test('DOC-05 le CSV neutralise les formules contenues dans les champs textuels', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  backend.espace.projets.find((p) => p.client_nom === 'Claire Bonnet')!.client_nom = '=1+1'
  await page.goto(`${URL_ARTISAN_DEMO}?vue=commissions`)
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: /Exporter.*CSV/ }).click(),
  ])
  const csv = await readFile((await download.path())!, 'utf8')
  expect(csv).toContain('"\'=1+1"')
  expect(csv).toContain('"24800"')
})

test('DOC-06 un brouillon possède une véritable action de reprise', async ({ page }) => {
  await installerBackendArtisan(page)
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await page.getByRole('button', { name: /Brouillons/ }).click()
  await expect(page.getByRole('button', { name: /Reprendre.*DEV-2026-015/ })).toBeVisible()
})

async function simulerSauvegarde(page: Page) {
  const payloads: Record<string, unknown>[] = []
  await page.route(rpc('creer_devis_by_token'), (route) => {
    payloads.push(route.request().postDataJSON().p_payload)
    return route.fulfill({ json: { ok: true, id: 'devis-demo-2', numero: 'DEV-2026-015', revision: 1 } })
  })
  await page.route(rpc('enregistrer_prix_by_token'), (route) => route.fulfill({ json: { ok: true } }))
  await page.route(rpc('set_devis_pdf_by_token'), (route) => route.fulfill({ json: { ok: true } }))
  await page.route('https://crm-test.supabase.co/storage/v1/object/**', (route) => route.fulfill({ json: { Key: 'fichier-fictif.pdf' } }))
  return payloads
}

async function ouvrirChantier(page: Page) {
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('searchbox', { name: 'Rechercher un chantier' }).fill('Sophie Laurent')
  await page.getByRole('button', { name: 'Ouvrir le chantier', exact: true }).click()
  return page.getByRole('dialog', { name: 'Sophie Laurent', exact: true })
}

test('DOC-07 reprend puis modifie un brouillon avec son identité, ses lignes et le même numéro', async ({ page }) => {
  await installerBackendArtisan(page)
  const payloads = await simulerSauvegarde(page)
  await page.route(rpc('devis_by_token'), (route) => route.fulfill({ json: { ok: true, devis: {
    id: 'devis-demo-2', numero: 'DEV-2026-015', revision: 0, statut: 'brouillon', client_nom: 'Client du brouillon',
    client_email: 'fictif@example.test', objet: 'Objet conservé', conditions: 'Conditions conservées',
    acompte_pct: 25, tva_mode: 'normal', date_validite: '2026-12-30',
    lignes: [{ designation: 'Prestation conservée', quantite: 5, unite: 'u', prix_unitaire: 33.33, tva_taux: 10 }],
  } } }))
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await page.getByRole('button', { name: /Reprendre.*DEV-2026-015/ }).click()
  const panneau = page.getByRole('dialog', { name: 'Modifier le devis DEV-2026-015' })
  await expect(panneau.getByRole('textbox', { name: 'Objet du devis', exact: true })).toHaveValue('Objet conservé')
  await expect(panneau.getByRole('textbox', { name: 'Conditions', exact: true })).toHaveValue('Conditions conservées')
  await expect(panneau.getByRole('textbox', { name: 'Désignation', exact: true })).toHaveValue('Prestation conservée')
  await panneau.getByRole('textbox', { name: 'Objet du devis', exact: true }).fill('Objet corrigé')
  const [download] = await Promise.all([page.waitForEvent('download'), panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()])
  expect(download.suggestedFilename()).toBe('devis-DEV-2026-015.pdf')
  await expect(panneau).toBeHidden()
  expect(payloads).toHaveLength(1)
  expect(payloads[0]).toMatchObject({ devis_id: 'devis-demo-2', client_nom: 'Client du brouillon', objet: 'Objet corrigé', conditions: 'Conditions conservées', total: 183.32, acompte_pct: 25 })
})

test('DOC-08 un envoi non confirmé conserve le brouillon sans annoncer envoyé ni muter directement le statut', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await simulerSauvegarde(page)
  let envois = 0
  await page.route('https://crm-test.supabase.co/functions/v1/devis-envoyer', (route) => {
    envois++
    return route.fulfill({ json: { ok: false, error: 'envoi_a_verifier' } })
  })
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif')
  await panneau.getByRole('textbox', { name: 'Email', exact: true }).fill('fictif@example.test')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Prestation fictive')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('100')
  await panneau.getByRole('button', { name: 'Au client', exact: true }).click()
  await expect(page.getByText(/La prise en charge de cet envoi reste à vérifier/)).toBeVisible()
  await expect(panneau).toBeVisible()
  expect(envois).toBe(1)
  expect(backend.appels.some((a) => a.nom === 'envoyer_devis_by_token')).toBe(false)
  expect(backend.sortiesBloquees).toEqual([])
})

test('DOC-09 assurances : format et taille refusés avant lecture IA ou téléversement', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(`${URL_ARTISAN_DEMO}?vue=entreprise`)
  const fichier = page.locator('input[type=file][accept="application/pdf,image/jpeg,image/png,image/webp"]').first()
  await fichier.setInputFiles({ name: 'programme.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('fictif') })
  await expect(page.getByText('Format non pris en charge', { exact: true })).toBeVisible()
  await fichier.setInputFiles({ name: 'trop-grand.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(6_000_001) })
  await expect(page.getByText('Attestation trop volumineuse', { exact: true })).toBeVisible()
  expect(backend.requetesNonSimulees).toEqual([])
  expect(backend.mutations).toEqual([])
})

test('DOC-10 une assurance refusée conserve le formulaire corrigé pour réessayer', async ({ page }) => {
  await installerBackendArtisan(page)
  await page.route('https://crm-test.supabase.co/functions/v1/assurance-lire', (route) => route.fulfill({ status: 503, json: { ok: false } }))
  await page.route('https://crm-test.supabase.co/storage/v1/object/**', (route) => route.fulfill({ json: {} }))
  await page.route(rpc('deposer_assurance_by_token'), (route) => route.fulfill({ json: { ok: false, error: 'attestation_expiree' } }))
  await page.goto(`${URL_ARTISAN_DEMO}?vue=entreprise`)
  await page.locator('input[type=file][accept="application/pdf,image/jpeg,image/png,image/webp"]').first().setInputFiles({ name: 'assurance-fictive.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictif') })
  await expect(page.getByText('Lecture automatique indisponible', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Assureur', exact: true }).fill('Assureur fictif')
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await expect(page.getByText(/Cette attestation est déjà expirée/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Assureur', exact: true })).toHaveValue('Assureur fictif')
  await expect(page.getByRole('button', { name: 'Envoyer', exact: true })).toBeEnabled()
})

test('DOC-11 le dépôt PDF refuse format et taille puis distingue fichier reçu et montant refusé', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await page.route('https://crm-test.supabase.co/storage/v1/object/**', (route) => route.fulfill({ json: {} }))
  await page.route(rpc('set_devis_by_token'), (route) => route.fulfill({ json: { ok: true } }))
  await page.route(rpc('set_montant_by_token'), (route) => route.fulfill({ json: { ok: false, error: 'montant_invalide' } }))
  const panneau = await ouvrirChantier(page)
  const fichier = panneau.locator('input[type=file][accept="application/pdf"]').first()
  await fichier.setInputFiles({ name: 'texte.txt', mimeType: 'text/plain', buffer: Buffer.from('fictif') })
  await expect(page.getByText('Format PDF uniquement', { exact: true })).toBeVisible()
  await fichier.setInputFiles({ name: 'trop-grand.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10_000_001) })
  await expect(page.getByText('PDF trop volumineux', { exact: true })).toBeVisible()
  await panneau.getByRole('spinbutton', { name: /Montant TTC —/ }).first().fill('100')
  await fichier.setInputFiles({ name: 'devis-fictif.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictif') })
  await expect(page.getByText('PDF reçu, montant non enregistré', { exact: true })).toBeVisible()
  expect(backend.requetesNonSimulees).toEqual([])
})

test('DOC-12 documents partagés : refus explicite puis téléchargement autorisé au bon token', async ({ page }) => {
  await installerBackendArtisan(page)
  await page.route(rpc('documents_projet_par_token'), (route) => route.fulfill({ json: [{ id: 'document-fictif', nom: 'Plan fictif.pdf', type_mime: 'application/pdf', taille_octets: 18, created_at: '2026-11-07T10:00:00Z' }] }))
  let refuse = true
  const demandes: Record<string, unknown>[] = []
  const url = 'https://crm-test.supabase.co/storage/v1/object/sign/documents/plan-fictif.pdf'
  await page.route('https://crm-test.supabase.co/functions/v1/document-signe', (route) => {
    demandes.push(route.request().postDataJSON())
    return route.fulfill({ json: refuse ? { ok: false } : { ok: true, url } })
  })
  await page.route(url, (route) => route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="plan-fictif.pdf"' }, body: '%PDF-1.4 fictif' }))
  const panneau = await ouvrirChantier(page)
  await panneau.getByRole('button', { name: 'Télécharger Plan fictif.pdf' }).click()
  await expect(page.getByText('Document indisponible', { exact: true })).toBeVisible()
  refuse = false
  const [download] = await Promise.all([page.waitForEvent('download'), panneau.getByRole('button', { name: 'Télécharger Plan fictif.pdf' }).click()])
  expect(download.suggestedFilename()).toBe('plan-fictif.pdf')
  expect(demandes).toEqual([{ token: 'affectation-demo-1', document_id: 'document-fictif', download: true }, { token: 'affectation-demo-1', document_id: 'document-fictif', download: true }])
})

test('DOC-13 les pannes de modèles et de prix sont visibles et récupérables', async ({ page }) => {
  await installerBackendArtisan(page)
  let panne = true
  await page.route(rpc('modeles_by_token'), (route) => route.fulfill(panne ? { status: 503, json: { message: 'panne fictive' } } : { json: [{ id: 'modele-fictif', nom: 'Modèle rétabli', source: 'perso', nb_lignes: 1, lignes: [{ designation: 'Réparation fictive', quantite: 1, unite: 'u', prix_unitaire: 50 }] }] }))
  await page.route(rpc('prix_artisan_by_token'), (route) => route.fulfill(panne ? { status: 503, json: { message: 'panne fictive' } } : { json: [{ id: 'prix-fictif', designation: 'Prix rétabli', unite: 'u', prix_unitaire: 75, cout_unitaire: null, utilisations: 1 }] }))
  const panneau = await ouvrirDevis(page)
  await expect(panneau.getByText('Les modèles ou les devis à copier sont indisponibles.')).toBeVisible()
  await expect(panneau.getByText('Votre bibliothèque de prix est indisponible.')).toBeVisible()
  panne = false
  await panneau.getByRole('button', { name: 'Réessayer les modèles' }).click()
  await panneau.getByRole('button', { name: 'Réessayer les prix' }).click()
  await panneau.getByRole('button', { name: /Modèle rétabli/ }).click()
  await expect(panneau.getByRole('textbox', { name: 'Désignation', exact: true })).toHaveValue('Réparation fictive')
})

test('DOC-14 entretien IA : refus récupérable, questions, bornes de marge et prix inconnu conservé', async ({ page }) => {
  await installerBackendArtisan(page)
  let panne = true
  let compositions = 0
  await page.route('https://crm-test.supabase.co/functions/v1/devis-entretien', (route) => {
    const body = route.request().postDataJSON()
    if (panne) return route.fulfill({ json: { ok: false, error: 'Service fictif indisponible' } })
    if (body.phase === 'questions') return route.fulfill({ json: { ok: true, questions: [{ cle: 'surface', libelle: 'Surface à traiter', type: 'nombre', unite: 'm²' }] } })
    compositions++
    return route.fulfill({ json: { ok: true, objet: 'Réparation fictive', lignes: [{ designation: 'Prestation à chiffrer', quantite: 12, unite: 'm²', prix_unitaire: null, source: 'aucune' }], hypotheses: ['Surface déclarée par le client'], manques: ['Prix à confirmer'] } })
  })
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('button', { name: /Décrire le chantier/ }).click()
  await panneau.getByRole('textbox', { name: 'Description du chantier' }).fill('Réparation fictive de la façade extérieure')
  await panneau.getByRole('button', { name: 'Poser les questions' }).click()
  await expect(page.getByText('Service fictif indisponible', { exact: true })).toBeVisible()
  panne = false
  await panneau.getByRole('button', { name: 'Poser les questions' }).click()
  await panneau.getByRole('textbox', { name: 'Surface à traiter' }).fill('12')
  await panneau.getByRole('textbox', { name: 'Marge visée en pourcentage' }).fill('80')
  await expect(panneau.getByRole('button', { name: 'Composer le devis' })).toBeDisabled()
  expect(compositions).toBe(0)
  await panneau.getByRole('textbox', { name: 'Marge visée en pourcentage' }).fill('30')
  await panneau.getByRole('button', { name: 'Composer le devis' }).click()
  await expect(panneau.getByText('Prix à confirmer', { exact: true })).toBeVisible()
  await panneau.getByRole('button', { name: /Reprendre.*ligne/ }).click()
  await expect(panneau.getByRole('textbox', { name: 'Désignation', exact: true })).toHaveValue('Prestation à chiffrer')
  await expect(panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true })).toHaveValue('')
})

test('DOC-15 enregistrer un modèle garde les lignes et un refus de suppression reste visible', async ({ page }) => {
  await installerBackendArtisan(page)
  const enregistres: Record<string, unknown>[] = []
  let suppressions = 0
  await page.route(rpc('enregistrer_modele_by_token'), (route) => {
    enregistres.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await page.route(rpc('supprimer_modele_by_token'), (route) => {
    suppressions++
    return route.fulfill({ json: { ok: false } })
  })
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Ligne du modèle fictif')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('125')
  await panneau.getByRole('button', { name: /Enregistrer cette ligne comme modèle/ }).click()
  await panneau.getByPlaceholder('Nom du modèle (ex. Ravalement complet)').fill('Modèle audit fictif')
  await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).first().click()
  await expect(page.getByText('Modèle « Modèle audit fictif » enregistré', { exact: true })).toBeVisible()
  expect(enregistres[0]).toMatchObject({ p_nom: 'Modèle audit fictif', p_lignes: [{ designation: 'Ligne du modèle fictif', prix_unitaire: 125 }] })
  await panneau.getByRole('button', { name: /Enregistrer cette ligne comme modèle/ }).click()
  page.once('dialog', (d) => d.dismiss())
  await panneau.getByRole('button', { name: 'Supprimer Réfection de couverture', exact: true }).click()
  expect(suppressions).toBe(0)
  page.once('dialog', (d) => d.accept())
  await panneau.getByRole('button', { name: 'Supprimer Réfection de couverture', exact: true }).click()
  await expect(page.getByText('Le modèle n’a pas pu être supprimé', { exact: true })).toBeVisible()
  expect(suppressions).toBe(1)
})

test('DOC-16 une ligne chiffrée sans désignation ne gonfle pas le total et bloque la sauvegarde', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Prestation complète')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('100')
  await panneau.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click()
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).last().fill('500')
  await expect(panneau.getByRole('complementary', { name: 'Récapitulatif et conditions du devis' })).toContainText('110,00 €')
  await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Complétez la désignation de chaque ligne chiffrée', { exact: true })).toBeVisible()
  expect(backend.requetesNonSimulees).toEqual([])
})

test('DOC-17 une identité indisponible bloque la génération et peut être rechargée', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await page.route(rpc('identite_by_token'), (route) => route.fulfill({ status: 503, json: { message: 'Fiche entreprise fictive indisponible' } }))
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Prestation fictive')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('100')
  await expect(panneau.getByRole('button', { name: 'Réessayer la fiche entreprise' })).toBeVisible()
  await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Votre fiche entreprise doit être chargée avant de générer le devis', { exact: true })).toBeVisible()
  expect(backend.requetesNonSimulees).toEqual([])
  await page.unroute(rpc('identite_by_token'))
  await panneau.getByRole('button', { name: 'Réessayer la fiche entreprise' }).click()
  await expect(panneau.getByRole('button', { name: 'Réessayer la fiche entreprise' })).toHaveCount(0)
})

test('DOC-18 les PDF historiques restent consultables avec assurances bloquées et un envoi incertain ne se relance pas', async ({ page }) => {
  await installerBackendArtisan(page, { assurancesEnAttente: true })
  await page.route(rpc('list_devis_by_token'), (route) => route.fulfill({ json: [{ id: 'devis-demo-incertain', numero: 'DEV-FICTIF-001', client_nom: 'Client fictif', objet: 'Devis conservé', total: 100, statut: 'brouillon', envoi_etat: 'incertain', pdf_url: 'https://crm-test.supabase.co/storage/v1/object/public/devis/fictif.pdf', date_devis: '2026-11-07' }] }))
  await page.goto(`${URL_ARTISAN_DEMO}?vue=devis`)
  await expect(page.getByText('Envoi à vérifier', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ouvrir le PDF du devis DEV-FICTIF-001' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Contacter Celexia', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reprendre le devis/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nouveau devis', exact: true })).toHaveCount(0)
})

test('DOC-19 un PDF refusé pour conflit de révision ne déclenche aucun envoi', async ({ page }) => {
  await installerBackendArtisan(page)
  await simulerSauvegarde(page)
  await page.route(rpc('set_devis_pdf_by_token'), (route) => {
    expect(route.request().postDataJSON().p_revision).toBe(1)
    return route.fulfill({ json: { ok: false, error: 'revision_conflit' } })
  })
  let envois = 0
  await page.route('https://crm-test.supabase.co/functions/v1/devis-envoyer', (route) => { envois++; return route.fulfill({ json: { ok: true } }) })
  const panneau = await ouvrirDevis(page)
  await panneau.getByRole('textbox', { name: 'Nom', exact: true }).fill('Client fictif')
  await panneau.getByRole('textbox', { name: 'Email', exact: true }).fill('fictif@example.test')
  await panneau.getByRole('textbox', { name: 'Désignation', exact: true }).fill('Prestation fictive')
  await panneau.getByRole('textbox', { name: 'Prix unitaire', exact: true }).fill('100')
  await panneau.getByRole('button', { name: 'Au client', exact: true }).click()
  await expect(page.getByText(/Ce brouillon a été modifié dans un autre onglet/)).toBeVisible()
  expect(envois).toBe(0)
  await expect(panneau.getByRole('textbox', { name: 'Désignation', exact: true })).toHaveValue('Prestation fictive')
})
