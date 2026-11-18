import { test, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from '../../tests/helpers/espace-artisan-backend'

/**
 * Photographie l'espace artisan tel qu'il est, écran par écran, et note la
 * position de chaque élément que la vidéo met en valeur.
 *
 * Sortie : public/captures/<écran>.png + public/captures/boites.json
 * (positions en pixels CSS du téléphone, 390 × 844).
 */
const SORTIE = fileURLToPath(new URL('../public/captures/', import.meta.url))
type Boite = { x: number; y: number; w: number; h: number }
const boites: Record<string, Record<string, Boite>> = {}

async function boite(l: Locator): Promise<Boite> {
  const b = await l.boundingBox()
  if (!b) throw new Error(`Élément introuvable à l’écran : ${l}`)
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
}

async function photo(page: Page, nom: string, elements: Record<string, Locator>) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  boites[nom] = {}
  for (const [cle, l] of Object.entries(elements)) boites[nom][cle] = await boite(l)
  await page.screenshot({ path: `${SORTIE}${nom}.png`, animations: 'disabled' })
}

/** Fait défiler la fiche chantier pour amener `cible` en haut, avec une marge. */
async function amener(cible: Locator, marge = 16) {
  await cible.evaluate((el, m) => {
    let p: HTMLElement | null = el.parentElement
    while (p && !(p.scrollHeight > p.clientHeight && getComputedStyle(p).overflowY !== 'visible')) p = p.parentElement
    const conteneur = p ?? document.scrollingElement!
    const haut = el.getBoundingClientRect().top - conteneur.getBoundingClientRect().top
    conteneur.scrollTop += haut - m
  }, marge)
}

test('captures de l’espace artisan', async ({ page }) => {
  await mkdir(SORTIE, { recursive: true })
  await installerBackendArtisan(page)
  await page.goto(URL_ARTISAN_DEMO)
  await page.getByRole('heading', { name: 'Mes chantiers' }).waitFor()

  // 1. Accueil : chiffres, « À traiter », barre du bas.
  const nav = page.getByRole('navigation', { name: 'Accès rapides artisan' })
  await photo(page, 'accueil', {
    tuiles: page.getByRole('region', { name: 'Synthèse de votre activité' }).locator('> div').first(),
    aTraiter: page.getByText('À traiter', { exact: true }).locator('xpath=..'),
    voir: page.getByRole('button', { name: 'Voir ces chantiers' }),
    navChantiers: nav.getByRole('button', { name: 'Mes chantiers' }),
    navDevis: nav.getByRole('button', { name: 'Mes devis' }),
    navEntreprise: nav.getByRole('button', { name: 'Mon entreprise' }),
    navMenu: nav.getByRole('button', { name: 'Ouvrir le menu' }),
    barre: nav,
  })

  // 2. Le menu complet.
  await nav.getByRole('button', { name: 'Ouvrir le menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Votre espace artisan' })
  await menu.waitFor()
  await photo(page, 'menu', {
    menu,
    metres: menu.getByRole('button', { name: /^Métrés/ }),
    commissions: menu.getByRole('button', { name: /^Commissions/ }),
    aide: menu.getByRole('button', { name: /^Aide et contact/ }),
  })
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })

  // 3. La liste des chantiers.
  await page.evaluate(() => {
    const el = document.getElementById('mes-chantiers')!
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: 'instant' })
  })
  const premiere = page.locator('#mes-chantiers [data-slot="card"]').first()
  await photo(page, 'liste', {
    recherche: page.getByRole('searchbox', { name: 'Rechercher un chantier' }),
    affichage: page.getByRole('tablist', { name: 'Affichage' }),
    parEtape: page.getByRole('tab', { name: 'Par étape' }),
    filtres: page.getByRole('button', { name: /^Tous/ }).locator('xpath=..'),
    premiere,
    nouveau: premiere.getByText('Nouveau — à appeler', { exact: true }),
  })

  // 4. Vue « Par étape ».
  await page.getByRole('tab', { name: 'Par étape' }).click()
  await photo(page, 'kanban', { tableau: page.locator('#chantiers-affichage') })
  await page.getByRole('tab', { name: 'Liste' }).click()

  // 5. La fiche du nouveau chantier.
  await premiere.getByRole('button', { name: 'Ouvrir le chantier' }).click()
  const fiche = page.getByRole('dialog', { name: 'Sophie Laurent' })
  await fiche.waitFor()
  await photo(page, 'fiche-haut', {
    entete: fiche.getByText('Fiche chantier').locator('xpath=..'),
    demande: fiche.getByRole('heading', { name: 'La demande' }).locator('xpath=..'),
    appeler: fiche.getByRole('link', { name: /^Appeler/ }),
  })

  // 6. L'avancement.
  const ouEnEtes = fiche.getByText('Où en êtes-vous ?', { exact: true })
  await amener(ouEnEtes)
  const parcours = fiche.getByRole('group', { name: 'Avancement du chantier' })
  const etape = (nom: string) => parcours.getByRole('button', { name: new RegExp(nom) }).first()
  await photo(page, 'fiche-avancement', {
    titre: ouEnEtes,
    parcours,
    contacte: etape('Client contacté'),
    rdv: etape('RDV pris'),
    devisEnvoye: etape('Devis envoyé'),
    devisSigne: etape('Devis signé'),
    termine: etape('Projet terminé'),
  })
  await etape('Client contacté').click()
  const merci = page.getByText('Mis à jour. Merci !')
  await merci.waitFor()
  await amener(ouEnEtes)
  await photo(page, 'fiche-contacte', { contacte: etape('Client contacté'), merci })
  await merci.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined)

  // 7. Appels, rappel, pause.
  const journal = fiche.getByText('Journal des appels', { exact: true })
  await amener(journal)
  await photo(page, 'fiche-appels', {
    journal: journal.locator('xpath=..'),
    pasDeReponse: fiche.getByRole('button', { name: 'Pas de réponse' }),
    jeLaiEu: fiche.getByRole('button', { name: 'Je l\'ai eu' }),
    aRappeler: fiche.getByRole('button', { name: 'À rappeler' }),
    rappel: fiche.getByRole('button', { name: /Me le rappeler plus tard/ }),
    enAttente: fiche.getByRole('button', { name: 'En attente', exact: true }),
  })

  // 8. Note et échanges.
  const note = fiche.getByRole('textbox', { name: 'Note de suivi' })
  await amener(fiche.getByText('Une note pour Celexia ?', { exact: true }))
  await note.fill('Cliente rappelée : RDV jeudi 14 h pour voir la toiture.')
  await photo(page, 'fiche-notes', {
    note,
    envoyer: fiche.getByRole('button', { name: 'Envoyer la note' }),
    echanges: fiche.getByText('Échanges avec Celexia').locator('xpath=..'),
  })
  await note.fill('')

  // 9. Documents et devis.
  const documents = fiche.getByText('Documents', { exact: true })
  await amener(documents)
  await photo(page, 'fiche-documents', {
    mesurer: fiche.getByRole('button', { name: 'Mesurer sur la carte' }),
    creer: fiche.getByRole('button', { name: 'Créer un devis' }),
    devis: fiche.getByText('Devis', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
    devisSigne: fiche.getByText('Devis signé par le client', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
  })

  // 10. Ne pas poursuivre.
  const retrait = fiche.getByRole('button', { name: 'Ne pas poursuivre ce chantier' })
  await amener(retrait, 520)
  await photo(page, 'fiche-retrait', { retrait })
  await retrait.click()
  const dialogue = page.getByRole('alertdialog')
  await dialogue.waitFor()
  await photo(page, 'retrait-dialogue', { dialogue })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // 11. Les autres rubriques.
  for (const [vue, nom] of [['commissions', 'Commissions'], ['entreprise', 'Mon entreprise'], ['devis', 'Mes devis'], ['aide', 'Aide et contact']] as const) {
    await page.goto(`${URL_ARTISAN_DEMO}?vue=${vue}`)
    await page.getByRole('heading', { name: nom }).first().waitFor()
    await photo(page, vue, { titre: page.getByRole('heading', { name: nom }).first() })
  }

  await writeFile(`${SORTIE}boites.json`, JSON.stringify(boites, null, 2))
})

test('capture ordinateur', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' })
  const page = await context.newPage()
  await installerBackendArtisan(page)
  await page.goto(`http://127.0.0.1:5180${URL_ARTISAN_DEMO}`)
  await page.getByRole('heading', { name: 'Mes chantiers' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${SORTIE}ordinateur.png`, animations: 'disabled' })
  await context.close()
})
