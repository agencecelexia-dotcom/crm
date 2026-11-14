import { test, expect, type Page } from '@playwright/test'
import { installerBackend } from './helpers/interface-backend'
import { AUTOMATISATIONS } from '../src/features/automatisations/catalogue'
import type { AutomatisationN8n } from '../supabase/functions/_automatisations-n8n'

async function installer(page: Page, options: { erreurN8n?: boolean; refusCommande?: boolean; erreurCrm?: boolean } = {}) {
  const audit = await installerBackend(page)
  const settings: Record<string, string> = { ...Object.fromEntries(AUTOMATISATIONS.map((a) => [a.cle, 'on'])), relances_pause: 'on' }
  const workflows: AutomatisationN8n[] = [
    { id: 'yAQgRSmtSxbHhzW4', nom: 'Celexia — invitations inscription via Gmail', active: true, archivee: false, declencheurs: ['Réception d’une demande'], pilotable: true, revision: 'v1', brouillon: false },
    { id: 'rWN2x7fDJEpKdIny', nom: 'CRM - Site Auto-Destroy (mort)', active: false, archivee: false, declencheurs: ['Réception d’une demande'], pilotable: true, revision: 'v1', brouillon: false },
    { id: '7JReVO3A6a1lEvge', nom: 'Email draft', active: false, archivee: false, declencheurs: [], pilotable: false, revision: 'v1', brouillon: false },
    { id: 'nouveau', nom: 'Nouvelle automatisation fictive', active: true, archivee: false, declencheurs: ['Horaire programmé'], pilotable: true, revision: 'v1', brouillon: false },
  ]
  const commandes: object[] = []
  const journal: object[] = []
  await page.route('**/rest/v1/app_settings?**', async (route) => route.fulfill({ status: options.erreurCrm ? 500 : 200, json: options.erreurCrm ? { message: 'Indisponible' } : Object.entries(settings).map(([cle, valeur]) => ({ cle, valeur })) }))
  await page.route('**/rest/v1/relances?**', (route) => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/automatisations_journal?**', (route) => route.fulfill({ json: journal }))
  await page.route('**/rest/v1/rpc/regler_automatisation', async (route) => {
    const body = route.request().postDataJSON(); commandes.push(body)
    if (options.refusCommande) return route.fulfill({ status: 400, json: { message: 'reglage_modifie' } })
    expect(body.p_attendue).toBe(settings[body.p_cle])
    settings[body.p_cle] = body.p_valeur
    journal.unshift({ id: journal.length + 1, source: 'crm', cle: body.p_cle, titre: body.p_cle, avant: body.p_attendue, apres: body.p_valeur, created_at: '2026-11-07T10:00:00Z' })
    await route.fulfill({ json: null })
  })
  await page.route('**/functions/v1/automatisations-n8n', async (route) => {
    const body = route.request().postDataJSON()
    if (options.erreurN8n) return route.fulfill({ status: 502, json: { error: 'acces_n8n_refuse' } })
    if (body.action === 'lister') return route.fulfill({ json: { workflows, verifie_le: '2026-11-07T10:00:00Z' } })
    commandes.push(body)
    if (options.refusCommande) return route.fulfill({ status: 409, json: { error: 'etat_modifie' } })
    const w = workflows.find((x) => x.id === body.id)!
    expect(body.revision).toBe(w.revision)
    w.active = body.active; w.revision = `v${commandes.length + 1}`
    await route.fulfill({ json: { workflow: w } })
  })
  return { ...audit, commandes, settings }
}

test('interrupteurs CRM et n8n persistants, pause conservée et scénarios découverts', async ({ page }) => {
  const b = await installer(page)
  await page.goto('/parametres/automatisations')
  const crm = page.getByRole('switch', { name: 'Avancement signalé par un artisan', exact: true })
  await expect(crm).toBeChecked()
  await crm.click(); await expect(crm).not.toBeChecked()
  expect(b.settings.relances_pause).toBe('on')
  await expect(page.getByText('Choix conservé · relances en pause').first()).toBeVisible()
  const n8n = page.getByRole('switch', { name: 'Invitations à rejoindre Célexia', exact: true })
  await n8n.click(); await expect(n8n).not.toBeChecked()
  await page.reload()
  await expect(crm).not.toBeChecked(); await expect(n8n).not.toBeChecked()
  await expect(page.getByText('Nouvelle automatisation fictive', { exact: true }).first()).toBeVisible()
  await expect(page.locator('[data-workflow="7JReVO3A6a1lEvge"]').getByRole('switch')).toHaveCount(0)
  expect(b.commandes).toHaveLength(2)
  expect(b.erreursPage).toEqual([])
  expect(b.requetesNonSimulees).toEqual([])
})

test('aide détaillée au survol, au clavier et au toucher, sans débordement', async ({ page }, info) => {
  await installer(page)
  for (const largeur of info.project.name === 'desktop' ? [1440, 768] : [360]) {
    await page.setViewportSize({ width: largeur, height: 900 })
    await page.goto('/parametres/automatisations')
    await page.getByRole('textbox', { name: 'Rechercher une automatisation' }).fill('suivi')
    const aide = page.getByRole('button', { name: 'Détails : Avancement signalé par un artisan', exact: true })
    if (info.project.name === 'desktop') await aide.hover(); else await aide.tap()
    await expect(page.getByText('Les notes seules et les mises en attente', { exact: false })).toBeVisible()
    await page.keyboard.press('Escape')
    await aide.focus()
    // Un clic fonctionne aussi si le bouton avait déjà le focus après Échap.
    await aide.click()
    await expect(page.getByRole('dialog', { name: 'Fonctionnement : Avancement signalé par un artisan' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `${info.outputDir}/automatisations-aide-${largeur}.png`, fullPage: true })
  }
})

test('recherche et filtres distinguent pause, arrêt et scénario manuel', async ({ page }) => {
  await installer(page); await page.goto('/parametres/automatisations')
  await page.getByRole('combobox', { name: 'Filtrer les automatisations' }).selectOption('manuelles')
  await expect(page.getByText('Brouillon Gmail manuel', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Invitations à rejoindre Célexia', exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Filtrer les automatisations' }).selectOption('arretees')
  await expect(page.getByRole('switch', { name: 'Relance contrat non signé', exact: true })).toBeChecked()
  await page.getByRole('textbox', { name: 'Rechercher une automatisation' }).fill('sans resultat fictif')
  await expect(page.getByText('Aucune automatisation ne correspond à cette recherche.')).toBeVisible()
})

test('une commande refusée garde l’état vérifié et affiche une erreur', async ({ page }) => {
  await installer(page, { refusCommande: true }); await page.goto('/parametres/automatisations')
  const crm = page.getByRole('switch', { name: 'Avancement signalé par un artisan', exact: true })
  await crm.click(); await expect(crm).toBeChecked()
  await expect(page.getByText('Ce réglage a été modifié ailleurs.', { exact: false })).toBeVisible()
  const n8n = page.getByRole('switch', { name: 'Invitations à rejoindre Célexia', exact: true })
  await n8n.click(); await expect(n8n).toBeChecked()
  await expect(page.getByText('L’état a changé depuis votre dernier affichage.', { exact: false })).toBeVisible()
})

test('n8n inaccessible ne fabrique pas d’états et laisse les réglages CRM accessibles', async ({ page }) => {
  await installer(page, { erreurN8n: true }); await page.goto('/parametres/automatisations')
  await expect(page.getByText('n8n refuse l’accès configuré.', { exact: false })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Avancement signalé par un artisan', exact: true })).toBeEnabled()
  await expect(page.getByText('Inventaire en cours ou partiellement indisponible')).toBeVisible()
})

test('une erreur CRM laisse les commandes n8n accessibles', async ({ page }) => {
  await installer(page, { erreurCrm: true }); await page.goto('/parametres/automatisations')
  await expect(page.getByText('Impossible de lire les réglages du CRM.', { exact: false })).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole('switch', { name: 'Invitations à rejoindre Célexia', exact: true })).toBeEnabled()
})

test('la réactivation du scénario destructeur explique l’action et permet d’annuler', async ({ page }) => {
  const b = await installer(page); await page.goto('/parametres/automatisations')
  const bouton = page.getByRole('switch', { name: 'Suppression des sites abandonnés', exact: true })
  await bouton.click()
  await expect(page.getByRole('alertdialog')).toContainText('supprimer les dépôts GitHub')
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(bouton).not.toBeChecked(); expect(b.commandes).toHaveLength(0)
  await bouton.click(); await page.getByRole('button', { name: 'Réactiver ce scénario' }).click()
  await expect(bouton).toBeChecked(); expect(b.commandes).toHaveLength(1)
})
