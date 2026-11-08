import { expect, test, type Page, type Route } from '@playwright/test'
import type { ProjetEspace, ProjetPerdu } from '../src/types/database'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'

type Backend = Awaited<ReturnType<typeof installerBackendArtisan>>
type Payload = Record<string, unknown>
const RPC = 'https://crm-test.supabase.co/rest/v1/rpc/'
const DATE = '2026-11-08T10:00:00Z'

test.beforeEach(({ page }, info) => {
  test.skip(info.config.metadata.isolatedInterface !== true, 'API simulées uniquement : tests/interface.config.ts')
  page.setDefaultTimeout(5_000)
})

async function intercepter(page: Page, nom: string, repondre: (payload: Payload, route: Route) => Promise<void>) {
  await page.route(`${RPC}${nom}`, async (route) => repondre(route.request().postDataJSON() as Payload, route))
}
function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
function unChantier(backend: Backend, changements: Partial<ProjetEspace> = {}) {
  const projet = { ...backend.espace.projets[0], suivis: [], non_lus: 0, ...changements }
  backend.espace.projets = [projet]
  return projet
}
async function ouvrir(page: Page, projet: ProjetEspace) {
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('button', { name: 'Ouvrir le chantier', exact: true }).click()
  return page.getByRole('dialog', { name: projet.client_nom ?? 'Client confidentiel', exact: true })
}
function verifierIsolation(backend: Backend) {
  expect(backend.erreursPage).toEqual([])
  expect(backend.requetesNonSimulees).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
}
function perdu(backend: Backend, modifications: Partial<ProjetPerdu> = {}): ProjetPerdu {
  const p = backend.espace.projets[0]
  const resultat: ProjetPerdu = {
    id: p.id, token: p.token, statut: 'perdu', metier: p.metier, metiers: p.metiers,
    sous_metier: null, description: p.description, budget_estime: p.budget_estime,
    montant_devis: 8200, client_ville: p.client_ville, client_nom: p.client_nom,
    sorti_le: DATE, motif: 'retrait', restaurable: true, derniere_raison: 'Planning complet',
    etape: 'devis_envoye', suivis: [], ...modifications,
  }
  backend.espace.projets_perdus = [resultat]
  backend.espace.projets = []
  return resultat
}

// Ces réponses reproduisent le CONTRAT des RPC concernées. Elles ne prétendent
// pas exécuter les triggers SQL : leurs risques sont distingués dans l’audit.
test('SUIVI-01 — la pause est visible après succès sans remplacer l’étape', async ({ page }) => {
  await intercepter(page, 'add_suivi_by_token', async (payload, route) => {
    expect(payload.p_statut).toBe('en_attente')
    projet.en_attente_depuis = DATE
    await json(route, { ok: true, sous_statut: 'en_attente' })
  })
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'contacte', etape: 'contacte' })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('button', { name: 'En attente', exact: true }).click()
  await expect(panneau.getByRole('button', { name: 'En attente', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Client contacté/ })).toHaveAttribute('aria-current', 'step')
  verifierIsolation(backend)
})

test('SUIVI-02 — reprendre la même étape lève la pause', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'contacte', etape: 'contacte', en_attente_depuis: DATE })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Client contacté/ }).click()
  await expect.poll(() => backend.mutations.length).toBe(1)
})

test('SUIVI-03 — une sortie de signature exige une confirmation avant mutation', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'devis_signe', etape: 'devis_signe', issue: 'gagne', montant_devis: 8200, montant_devis_signe: 8200, devis_depose: true })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Devis envoyé/ }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  expect(backend.mutations).toEqual([])
})

test('la signature demande confirmation et Annuler ne modifie rien', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'devis_envoye', etape: 'devis_envoye', montant_devis: 8200, devis_depose: true })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Devis signé/ }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('8 200')
  await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(backend.mutations).toEqual([])
  verifierIsolation(backend)
})

test('le retour avant le devis prévient de sa suppression et peut être annulé', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'devis_envoye', etape: 'devis_envoye', montant_devis: 8200, devis_depose: true })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Client contacté/ }).click()
  await expect(page.getByRole('alertdialog')).toContainText('il faudra le déposer à nouveau')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(backend.mutations).toEqual([])
  verifierIsolation(backend)
})

test('une note en erreur conserve son texte et reste réessayable', async ({ page }) => {
  let appels = 0
  await intercepter(page, 'add_suivi_by_token', async (_payload, route) => {
    appels++
    await json(route, appels === 1 ? { ok: false, error: 'indisponible' } : { ok: true })
  })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  const note = panneau.getByRole('textbox', { name: 'Note de suivi' })
  await note.fill('Le client sera disponible demain après-midi.')
  await panneau.getByRole('button', { name: 'Envoyer la note' }).click()
  await expect(page.getByText("Impossible d'enregistrer", { exact: true })).toBeVisible()
  await expect(note).toHaveValue('Le client sera disponible demain après-midi.')
  await panneau.getByRole('button', { name: 'Envoyer la note' }).click()
  await expect(note).toHaveValue('')
  expect(appels).toBe(2)
  verifierIsolation(backend)
})

test('SUIVI-04 — une nouvelle note saisie pendant l’envoi n’est pas effacée', async ({ page }) => {
  let liberer!: () => void
  const attente = new Promise<void>((resolve) => { liberer = resolve })
  await intercepter(page, 'add_suivi_by_token', async (_payload, route) => { await attente; await json(route, { ok: true }) })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  const note = panneau.getByRole('textbox', { name: 'Note de suivi' })
  await note.fill('Première note à transmettre')
  await panneau.getByRole('button', { name: 'Envoyer la note' }).click()
  await expect(panneau.getByRole('button', { name: 'Envoyer la note' })).toBeDisabled()
  await note.fill('Deuxième note encore en rédaction')
  liberer()
  await expect(panneau.getByRole('button', { name: 'Envoyer la note' })).toBeEnabled()
  await expect(note).toHaveValue('Deuxième note encore en rédaction')
})

test('un double clic pendant l’envoi de note ne lance pas une seconde requête', async ({ page }) => {
  let appels = 0
  let liberer!: () => void
  const attente = new Promise<void>((resolve) => { liberer = resolve })
  await intercepter(page, 'add_suivi_by_token', async (_payload, route) => { appels++; await attente; await json(route, { ok: true }) })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  await panneau.getByRole('textbox', { name: 'Note de suivi' }).fill('Note à transmettre une seule fois')
  const envoyer = panneau.getByRole('button', { name: 'Envoyer la note' })
  await envoyer.click()
  await expect(envoyer).toBeDisabled()
  await envoyer.evaluate((element) => (element as HTMLButtonElement).click())
  await expect.poll(() => appels).toBe(1)
  liberer()
  await expect(panneau.getByRole('textbox', { name: 'Note de suivi' })).toHaveValue('')
  verifierIsolation(backend)
})

for (const [libelle, resultat] of [['Pas de réponse', 'pas_de_reponse'], ["Je l'ai eu", 'repondu'], ['À rappeler', 'rappeler']] as const) {
  test(`journal d’appel ${libelle} : erreur, réessai et payload exact`, async ({ page }) => {
    const appels: Payload[] = []
    await intercepter(page, 'log_appel_by_token', async (payload, route) => {
      appels.push(payload)
      await json(route, appels.length === 1 ? { ok: false } : { ok: true })
    })
    const backend = await installerBackendArtisan(page)
    const projet = unChantier(backend)
    const panneau = await ouvrir(page, projet)
    await panneau.getByRole('button', { name: libelle, exact: true }).click()
    await expect(page.getByText("Impossible d'enregistrer l'appel", { exact: true })).toBeVisible()
    await panneau.getByRole('button', { name: libelle, exact: true }).click()
    await expect.poll(() => appels.length).toBe(2)
    expect(appels[1]).toEqual({ p_token: projet.token, p_resultat: resultat })
    verifierIsolation(backend)
  })
}

test('SUIVI-05 — un RDV existant est affiché même sans ancienne note libre', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'rdv_pris', etape: 'rdv_pris', date_rdv: '2026-11-10T13:30:00Z', suivis: [] })
  const panneau = await ouvrir(page, projet)
  await expect(panneau.getByRole('group', { name: 'Avancement du chantier' })).toContainText(/10 novembre.*14[: h]30/)
})

test('RDV : date obligatoire et annulation sans écriture', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /RDV pris/ }).click()
  await expect(panneau.getByRole('button', { name: 'Confirmer le RDV' })).toBeDisabled()
  await panneau.getByRole('textbox', { name: 'Heure du rendez-vous (facultatif)' }).fill('15:00')
  await panneau.getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(backend.mutations).toEqual([])
  verifierIsolation(backend)
})

test('un rappel en erreur garde la date existante et peut être retiré ensuite', async ({ page }) => {
  let appels = 0
  await intercepter(page, 'definir_rappel_by_token', async (payload, route) => {
    appels++
    expect(payload.p_quand).toBeNull()
    if (appels > 1) projet.rappel_le = null
    await json(route, appels === 1 ? { ok: false, error: 'date_passee' } : { ok: true })
  })
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'contacte', etape: 'contacte', rappel_le: '2026-11-15T10:00:00Z' })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('button', { name: 'Retirer', exact: true }).click()
  await expect(page.getByText('Rappel impossible', { exact: true })).toBeVisible()
  await expect(panneau.getByText(/À reprendre le/)).toBeVisible()
  await panneau.getByRole('button', { name: 'Retirer', exact: true }).click()
  await expect(panneau.getByRole('button', { name: /Me le rappeler plus tard/ })).toBeVisible()
  expect(appels).toBe(2)
  verifierIsolation(backend)
})

test('la perte exige une raison, l’erreur la conserve et Annuler ne réécrit rien', async ({ page }) => {
  let appels = 0
  await intercepter(page, 'add_suivi_by_token', async (payload, route) => {
    appels++
    expect(payload.p_statut).toBe('perdu')
    await json(route, { ok: false, error: 'motif_requis' })
  })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  await panneau.getByRole('button', { name: 'Pas de suite / Perdu', exact: true }).click()
  const confirmer = panneau.getByRole('button', { name: 'Confirmer « perdu »' })
  await expect(confirmer).toBeDisabled()
  const raison = panneau.getByRole('textbox', { name: 'Raison de la perte du chantier' })
  await raison.fill('Le client a choisi un concurrent')
  await confirmer.click()
  await expect(page.getByText('Précisez la raison de la perte du chantier.', { exact: true })).toBeVisible()
  await expect(raison).toHaveValue('Le client a choisi un concurrent')
  await panneau.getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(appels).toBe(1)
  verifierIsolation(backend)
})

test('SUIVI-06 — un refus métier de perte explique de contacter Celexia', async ({ page }) => {
  await intercepter(page, 'add_suivi_by_token', async (_payload, route) => {
    await json(route, { code: 'P0001', message: 'abandon_refuse:commission_encaissee', hint: 'Passez par Celexia pour l’annuler.' }, 400)
  })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend, { statut: 'devis_signe', etape: 'devis_signe', issue: 'gagne', commission_encaissee: true }))
  await panneau.getByRole('button', { name: 'Pas de suite / Perdu', exact: true }).click()
  await panneau.getByRole('textbox', { name: 'Raison de la perte du chantier' }).fill('Déclaré signé par erreur')
  await panneau.getByRole('button', { name: 'Confirmer « perdu »' }).click()
  await expect(page.getByText(/Contactez Celexia|Passez par Celexia/i)).toBeVisible()
})

test('retrait : motif et raison requis, refus financier lisible et dialogue conservé', async ({ page }) => {
  const appels: Payload[] = []
  await intercepter(page, 'retirer_chantier_by_token', async (payload, route) => {
    appels.push(payload)
    await json(route, { ok: false, error: 'commission_encaissee' })
  })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  await panneau.getByRole('button', { name: 'Me retirer de ce chantier' }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation.getByRole('button', { name: 'Confirmer le retrait' })).toBeDisabled()
  await confirmation.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Trop loin / hors de ma zone' }).click()
  await confirmation.getByRole('textbox', { name: /Pourquoi vous retirez-vous/ }).fill('Trop loin de mon secteur')
  await confirmation.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(page.getByText(/commission de ce chantier est déjà réglée/)).toBeVisible()
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(appels).toHaveLength(1)
  verifierIsolation(backend)
})

test('contrat non signé : aucun suivi, appel ou montant accessible dans la fiche', async ({ page }) => {
  const backend = await installerBackendArtisan(page, { signe: false })
  const projet = unChantier(backend)
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('button', { name: 'Ouvrir le chantier', exact: true }).click()
  const panneau = page.getByRole('dialog', { name: 'Client confidentiel', exact: true })
  await expect(panneau.getByRole('group', { name: 'Avancement du chantier' })).toHaveCount(0)
  await expect(panneau.getByRole('link', { name: /Appeler/ })).toHaveCount(0)
  await expect(panneau.getByRole('textbox', { name: 'Note de suivi' })).toHaveCount(0)
  await expect(panneau).not.toContainText(projet.client_nom!)
  await expect(panneau.getByRole('link', { name: 'Signer le contrat', exact: true })).toBeVisible()
  verifierIsolation(backend)
})

test('SUIVI-07 — les archives ne révèlent pas les échanges client avant signature', async ({ page }) => {
  const backend = await installerBackendArtisan(page, { signe: false })
  perdu(backend, { suivis: [{ auteur: 'agence', type: 'note', statut: null, message: 'Confidentiel audit : appeler Sophie au 0600000100', created_at: DATE }] })
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('button', { name: /^Perdus/ }).click()
  await page.getByRole('button', { name: 'Client confidentiel', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toContainText('Confidentiel audit')
})

test('SUIVI-08 — filtre Devis signé puis Par étape conserve les résultats sélectionnés', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('button', { name: /^Devis signé\s/ }).click()
  await expect(page.getByText('Claire Bonnet', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Par étape', exact: true }).click()
  await expect(page.getByText('Claire Bonnet', { exact: true })).toBeVisible()
  verifierIsolation(backend)
})

test('SUIVI-09 — une restauration refusée conserve le dossier ouvert pour réessayer', async ({ page }) => {
  await intercepter(page, 'restaurer_chantier_by_token', async (_payload, route) => json(route, { ok: false, error: 'deja_attribue' }))
  const backend = await installerBackendArtisan(page)
  const p = perdu(backend)
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('button', { name: /^Perdus/ }).click()
  await page.getByRole('button', { name: p.client_nom!, exact: true }).click()
  const panneau = page.getByRole('dialog', { name: p.client_nom!, exact: true })
  await panneau.getByRole('button', { name: 'Remettre dans mon pipe' }).click()
  await expect(page.getByText('Restauration impossible', { exact: true })).toBeVisible()
  await expect(panneau).toBeVisible()
})

test('la liste des perdus permet de réessayer une restauration sans doublon pendant l’envoi', async ({ page }) => {
  let appels = 0
  let liberer!: () => void
  const attente = new Promise<void>((resolve) => { liberer = resolve })
  await intercepter(page, 'restaurer_chantier_by_token', async (_payload, route) => {
    appels++
    if (appels === 1) await attente
    await json(route, { ok: false, error: 'projet_clos' })
  })
  const backend = await installerBackendArtisan(page)
  perdu(backend)
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('button', { name: /^Perdus/ }).click()
  await page.getByRole('button', { name: 'Reprendre ce chantier' }).click()
  await expect(page.getByRole('button', { name: 'Restauration…' })).toBeDisabled()
  liberer()
  await expect(page.getByText(/a été clôturé par Celexia/)).toBeVisible()
  await page.getByRole('button', { name: 'Reprendre ce chantier' }).click()
  await expect.poll(() => appels).toBe(2)
  verifierIsolation(backend)
})

test('RDV : échec sans perte de date puis succès avec heure et étape actualisées', async ({ page }) => {
  const appels: Payload[] = []
  await intercepter(page, 'add_suivi_by_token', async (payload, route) => {
    appels.push(payload)
    if (appels.length === 1) return json(route, { ok: false, error: 'date_rdv_requise' })
    projet.statut = 'rdv_pris'
    projet.etape = 'rdv_pris'
    projet.date_rdv = payload.p_date_rdv as string
    await json(route, { ok: true })
  })
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'contacte', etape: 'contacte' })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /RDV pris/ }).click()
  await panneau.getByRole('button', { name: 'Choisir la date', exact: true }).click()
  await page.locator('[data-slot="calendar"] button[data-day="10/11/2026"]').click()
  await page.keyboard.press('Escape')
  await panneau.getByRole('textbox', { name: 'Heure du rendez-vous (facultatif)' }).fill('15:00')
  await panneau.getByRole('button', { name: 'Confirmer le RDV' }).click()
  await expect(page.getByText('Choisissez la date du rendez-vous.', { exact: true })).toBeVisible()
  await expect(panneau.getByRole('textbox', { name: 'Heure du rendez-vous (facultatif)' })).toHaveValue('15:00')
  await panneau.getByRole('button', { name: 'Confirmer le RDV' }).click()
  await expect(panneau.getByRole('button', { name: 'Confirmer le RDV' })).toHaveCount(0)
  await expect(panneau.getByRole('group', { name: 'Avancement du chantier' })).toContainText('10 novembre 2026 à 15:00')
  expect(appels[1]).toMatchObject({ p_token: projet.token, p_statut: 'rdv_pris', p_date_rdv: '2026-11-10T14:00:00.000Z' })
  verifierIsolation(backend)
})

test('rappel : annulation puis programmation datée sans changer l’étape du devis', async ({ page }) => {
  const appels: Payload[] = []
  await intercepter(page, 'definir_rappel_by_token', async (payload, route) => {
    appels.push(payload)
    projet.rappel_le = payload.p_quand as string
    await json(route, { ok: true })
  })
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'devis_envoye', etape: 'devis_envoye' })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('button', { name: /Me le rappeler plus tard/ }).click()
  await expect(panneau.getByRole('button', { name: 'Programmer le rappel' })).toBeDisabled()
  await panneau.getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(appels).toEqual([])
  await panneau.getByRole('button', { name: /Me le rappeler plus tard/ }).click()
  await panneau.getByRole('button', { name: 'Choisir la date', exact: true }).click()
  await page.locator('[data-slot="calendar"] button[data-day="15/11/2026"]').click()
  await page.keyboard.press('Escape')
  await panneau.getByRole('button', { name: 'Programmer le rappel' }).click()
  await expect(panneau.getByText(/À reprendre le/)).toBeVisible()
  await expect(panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Devis envoyé/ })).toHaveAttribute('aria-current', 'step')
  expect(appels).toEqual([{ p_token: projet.token, p_quand: '2026-11-14T23:00:00.000Z' }])
  verifierIsolation(backend)
})

test('retrait : changer pour un motif non relançable retire aussi la date cachée du payload', async ({ page }) => {
  const appels: Payload[] = []
  await intercepter(page, 'retirer_chantier_by_token', async (payload, route) => { appels.push(payload); await json(route, { ok: true }) })
  const backend = await installerBackendArtisan(page)
  const panneau = await ouvrir(page, unChantier(backend))
  await panneau.getByRole('button', { name: 'Me retirer de ce chantier' }).click()
  const confirmation = page.getByRole('alertdialog')
  await confirmation.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Autre', exact: true }).click()
  await confirmation.getByLabel('À recontacter le (facultatif)', { exact: true }).fill('2026-12-10')
  await confirmation.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Pas mon métier', exact: true }).click()
  await expect(confirmation.getByLabel('À recontacter le (facultatif)', { exact: true })).toHaveCount(0)
  await confirmation.getByRole('textbox', { name: /Pourquoi vous retirez-vous/ }).fill('Ces travaux ne correspondent pas à mon métier')
  await confirmation.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(confirmation).toBeHidden()
  expect(appels[0]).toMatchObject({ p_motif: 'hors_competence', p_recontacter_le: null })
  verifierIsolation(backend)
})

test('un devis signé déposé interdit le recul sans requête et explique la démarche', async ({ page }) => {
  const backend = await installerBackendArtisan(page)
  const projet = unChantier(backend, { statut: 'devis_signe', etape: 'devis_signe', issue: 'gagne', devis_signe_depose: true, montant_devis_signe: 8200 })
  const panneau = await ouvrir(page, projet)
  await panneau.getByRole('group', { name: 'Avancement du chantier' }).getByRole('button', { name: /Devis envoyé/ }).click()
  await expect(page.getByText('Un devis signé est déjà déposé. Contactez Celexia pour corriger ce chantier.', { exact: true })).toBeVisible()
  expect(backend.mutations).toEqual([])
  verifierIsolation(backend)
})
