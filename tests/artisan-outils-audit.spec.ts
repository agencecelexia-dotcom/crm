import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { installerBackendArtisan, URL_ARTISAN_DEMO } from './helpers/espace-artisan-backend'
import type { ContexteMetre, Metre } from '../src/features/metre/use-metres'
import type { MaisonChantier } from '../src/features/metre/use-batiment-chantier'
import { aire, longueur, type Point } from '../src/features/metre/geometrie'
import type { Releve } from '../src/features/metre/releve'
import type { LigneMetrage } from '../src/features/metre/use-metrage'
import type { PhotoFacade } from '../src/features/metre/use-photos-facade'
import { tirerOuvertures, type LectureVision } from '../src/features/metre/ouvertures'

// Régressions après baseline documentée dans audit/2026-11-08-artisan-outils-audit.md.
// Aucune donnée réelle et aucune requête externe non interceptée.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.config.metadata.isolatedInterface !== true, 'Backend fictif obligatoire')
  page.setDefaultTimeout(10_000)
  // Le serveur Vite est partagé entre agents : le canal HMR est neutralisé
  // pour qu'une édition parallèle ne recharge pas le parcours en cours.
  await page.routeWebSocket('ws://127.0.0.1:5180/**', (ws) => { ws.onMessage(() => undefined) })
})

const contour: Point[] = [[2.35, 48.856], [2.35015, 48.856], [2.35015, 48.8561], [2.35, 48.8561]]
const releve = JSON.parse(readFileSync(new URL('./fixtures/copc/deux-pans-simple/releve.json', import.meta.url), 'utf8')) as Releve
const cleabs = 'BATIMENT0000000000000001'
const metre: Metre = {
  id: '00000000-0000-4000-8000-000000000001', nom: 'Terrasse de démonstration', type: 'surface',
  geometrie: contour, surface_m2: 120, perimetre_m: 44, longueur_m: null, hauteur_m: null,
  pente_pct: null, surface_reelle_m2: null, ouvertures_m2: null, azimut: null,
  pente_source: null, debord_m: null, part_toiture: null, versant: null, hauteur_source: null,
  source: 'dessin', created_at: '2026-11-07T10:00:00Z',
}

async function installerOutils(page: Page, options: { contexteErreur?: boolean; contexteRefuse?: boolean; avecMaison?: boolean; iaFinie?: boolean; avecReleve?: boolean; parcoursIA?: boolean; photos?: boolean; avecPosition?: boolean; lotRefuse?: boolean; iaBloquee?: boolean; releveBloque?: boolean } = {}) {
  const backend = await installerBackendArtisan(page)
  const appels: { nom: string; body: Record<string, unknown> }[] = []
  const inconnues: string[] = []
  const metrage: LigneMetrage[] = []
  const photos: PhotoFacade[] = []
  let lecturesIA = 0
  let etatsIA = 0
  let finirIA = false
  let finirReleve = false
  let orientationPhoto = 'sud'
  const ctx: ContexteMetre = {
    ok: !options.contexteRefuse, error: options.contexteRefuse ? 'chantier_retire' : undefined,
    projet_id: 'chantier-demo-1', affectation_id: 'affectation-demo-1', client_ville: 'Ville de démonstration',
    client_adresse: '12 rue des Ateliers', client_code_postal: '00000', latitude: 48.85605,
    longitude: 2.350075, metier: 'Couverture', metiers: ['Couverture'], metres: [metre],
  }
  const maison: MaisonChantier = {
    ok: true, confiance: options.avecMaison ? 'confirmee' : 'aucune', methode: options.avecMaison ? 'confirmee' : null,
    principal: options.avecMaison ? { cleabs, contour, aire: 120 } : null, autres: [],
    point: options.avecMaison || options.avecPosition ? [2.350075, 48.85605] : null,
    adresse_retrouvee: 'Adresse fictive', score: 1, commune_saisie: 'Ville de démonstration',
    commune_retrouvee: 'Ville de démonstration', commune_differente: false, numero_saisi: '12', message: null,
  }
  // Ces routes s'ajoutent au garde-fou réseau du helper, sans le modifier.
  await page.route('https://crm-test.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const nom = url.pathname.split('/').at(-1)!
    const body = route.request().headers()['content-type']?.includes('application/json') ? route.request().postDataJSON() as Record<string, unknown> : {}
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/facades/') && options.photos) {
      appels.push({ nom: 'upload-photo', body: {} })
      return json({ Key: 'facades/demo/photo.jpg' })
    }
    const couvertes = ['metre_contexte_by_token', 'supprimer_metre_by_token', 'enregistrer_metre_by_token', 'corriger_metrage_by_token', 'corriger_metrages_by_token', 'batiment-chantier', 'releve-lidar', 'toiture-lidar', 'fiche-maison', 'metre-ia', 'metrage_by_token', 'facade-photo']
    if (!couvertes.includes(nom)) return route.fallback()
    appels.push({ nom, body })
    switch (nom) {
      case 'metre_contexte_by_token': return options.contexteErreur ? json({ code: 'DEMO_PANNE', message: 'Panne simulée' }, 503) : json(ctx)
      case 'supprimer_metre_by_token': return json({ ok: false, error: 'token_invalide' })
      case 'enregistrer_metre_by_token': {
        const geometrie = body.p_geometrie as Point[]
        const type = body.p_type as Metre['type']
        if (geometrie.length < (type === 'surface' ? 3 : 2)) return json({ ok: false, error: 'geometrie_insuffisante' })
        const enregistre: Metre = { ...metre, id: `mesure-demo-${ctx.metres.length}`, nom: String(body.p_nom), type, geometrie, surface_m2: type === 'surface' ? aire(geometrie) : null, longueur_m: type === 'longueur' ? longueur(geometrie, false) : null }
        ctx.metres.push(enregistre)
        return json({ ok: true, ...enregistre })
      }
      case 'corriger_metrages_by_token': {
        if (options.lotRefuse) return json({ ok: false, error: 'valeur_invalide' })
        const corrections = body.p_corrections as { cle: string; unite: LigneMetrage['unite']; valeur: number }[]
        for (const correction of corrections) metrage.push({ cle: correction.cle, unite: correction.unite, valeur_declaree: null, declaree_par: null, citation: null, valeur_mesuree: null, mesure_source: null, statut: 'confirme', valeur_retenue: correction.valeur, retenue_par: 'artisan', note: body.p_note as string })
        return json({ ok: true, nombre: corrections.length })
      }
      case 'corriger_metrage_by_token': {
        const ligne: LigneMetrage = { cle: String(body.p_cle), unite: body.p_unite as LigneMetrage['unite'], valeur_declaree: 95, declaree_par: 'client', citation: null, valeur_mesuree: 104, mesure_source: 'lidar', statut: 'confirme', valeur_retenue: Number(body.p_valeur), retenue_par: 'artisan', note: body.p_note as string | null }
        const index = metrage.findIndex((m) => m.cle === ligne.cle)
        if (index >= 0) metrage[index] = ligne
        else metrage.push(ligne)
        return json({ ok: true })
      }
      case 'batiment-chantier': return json(maison)
      case 'releve-lidar': return json(options.releveBloque && !finirReleve ? { ok: true, trouve: true, statut: 'en_cours' } : options.avecReleve ? { ok: true, trouve: true, id: 'releve-demo', statut: 'fait', releve } : { ok: true, statut: 'hors_couverture', releve: null })
      case 'toiture-lidar': return json({ ok: true, couvert: false, fiable: false, motif: 'hors_couverture' })
      case 'fiche-maison': return json({ ok: true, bdnb: null, dpe: null, urbanisme: null, risques: null, cadastre: null, sources: {} })
      case 'metrage_by_token': return json({ ok: true, metrage })
      case 'metre-ia':
        if (options.parcoursIA && body.action === 'lire') {
          lecturesIA++
          etatsIA = 0
          return json({ ok: true, trouve: true, statut: 'en_cours', etapes: [] })
        }
        if (options.parcoursIA && body.action === 'etat' && lecturesIA) {
          etatsIA++
          return json(options.iaBloquee ? finirIA ? { ok: true, trouve: true, statut: 'fait', scene: { volumes: [] }, niveaux: null } : { ok: true, trouve: true, statut: 'en_cours', etapes: [] } : etatsIA < 2 ? { ok: true, trouve: true, statut: 'en_cours', etapes: [] } : lecturesIA === 1 ? { ok: true, trouve: true, statut: 'echec', motif: 'vision_occupee' } : { ok: true, trouve: true, statut: 'fait', scene: { volumes: [] }, niveaux: null })
        }
        if (body.action === 'etat') return json(options.iaFinie ? { ok: true, trouve: true, statut: 'fait', scene: { volumes: [] }, niveaux: null } : { ok: true, trouve: false })
        inconnues.push(`${nom}:${String(body.action)}`)
        return json({ error: 'Appel IA interdit dans l’audit' }, 501)
      case 'facade-photo':
        if (body.action === 'chercher') return json({ ok: true, photos })
        if (body.action === 'materiau_toit' && !body.lire) return json({ ok: true, materiaux: null })
        if (options.photos) {
          if (body.action === 'deposer') { orientationPhoto = String(body.orientation); return json({ ok: true, chemin: 'demo/photo.jpg', jeton: 'jeton-fictif' }) }
          if (body.action === 'enregistrer') {
            const photo: PhotoFacade = { id: 'photo-demo', orientation: orientationPhoto, source: 'artisan', auteur: null, licence: null, page: null, pris_le: '2026-11-08T10:00:00Z', largeur: 100, hauteur: 100, distance_m: null, incidence: null, colonnes: null, lecture: null, ecartees: [], url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="tan"/></svg>') }
            photos.unshift(photo)
            return json({ ok: true, photo })
          }
          if (body.action === 'lire') {
            const vision: LectureVision = { facade_visible: true, meme_maison: 'oui', cadre: { gauche: 100, haut: 200, droite: 900, bas: 800 }, ligne_sol: 800, ligne_gouttiere: 200, mur_entier: true, part_cachee: 0, niveaux: 1, ouvertures: [{ type: 'fenetre', gauche: 200, haut: 400, droite: 400, bas: 600 }], materiau: 'enduit', remarque: 'Fixture synthétique' }
            const mur = { longueur: 10, hauteurGouttiere: 6, surfaceLibre: 60 }
            const lecture = { vision, mur, resultat: tirerOuvertures(vision, mur, 1, null, 'artisan') }
            photos[0].lecture = lecture
            return json({ ok: true, lecture })
          }
          if (body.action === 'ecarter') {
            photos[0].ecartees = body.ecartee ? [Number(body.rang)] : []
            return json({ ok: true, ecartees: photos[0].ecartees })
          }
        }
        inconnues.push(`${nom}:${String(body.action)}`)
        return json({ error: 'Lecture ou mutation externe interdite' }, 501)
    }
  })
  await page.route('https://data.geopf.fr/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/wfs/ows') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: cleabs, properties: { cleabs, hauteur: 6, nature: 'Indifférenciée' }, geometry: { type: 'Polygon', coordinates: [[...contour, contour[0]]] } }] }) })
    if (url.pathname === '/wmts') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
    inconnues.push(url.pathname)
    return route.abort('blockedbyclient')
  })
  return { ...backend, appelsOutils: appels, inconnues, metrage, terminerIA: () => { finirIA = true }, terminerReleve: () => { finirReleve = true } }
}

async function ouvrirMetre(page: Page) {
  await page.goto(`${URL_ARTISAN_DEMO}?vue=metres`)
  await page.getByRole('button', { name: /Sophie Laurent/ }).click()
  const feuille = page.getByRole('dialog', { name: 'Sophie Laurent', exact: true })
  await expect(feuille).toBeVisible()
  return feuille
}

test('une panne du contexte ne prétend pas que le bâtiment est absent', async ({ page }) => {
  const backend = await installerOutils(page, { contexteErreur: true })
  const feuille = await ouvrirMetre(page)
  await expect.poll(() => backend.appelsOutils.filter((a) => a.nom === 'metre_contexte_by_token').length).toBeGreaterThanOrEqual(2)
  expect(backend.inconnues).toEqual([])
  await expect(feuille.getByText(/Aucun bâtiment ici/)).toHaveCount(0)
  await expect(feuille.getByRole('button', { name: 'Réessayer', exact: true })).toBeVisible()
})

test('un chantier retiré ferme les actions de mesure et de repositionnement', async ({ page }) => {
  await installerOutils(page, { contexteRefuse: true })
  const feuille = await ouvrirMetre(page)
  await expect(feuille.getByText('Ce chantier ne vous est plus attribué.', { exact: true })).toBeVisible()
  await expect(feuille.getByRole('button', { name: 'Le chantier est ici', exact: true })).toHaveCount(0)
})

test('le refus de suppression ne produit pas un message de succès', async ({ page }) => {
  const backend = await installerOutils(page)
  const feuille = await ouvrirMetre(page)
  await feuille.getByText('Déjà enregistré (1)', { exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await feuille.getByRole('button', { name: 'Supprimer Terrasse de démonstration', exact: true }).click()
  await expect.poll(() => backend.appelsOutils.filter((a) => a.nom === 'supprimer_metre_by_token').length).toBe(1)
  await expect(page.getByText('Suppression impossible', { exact: true })).toBeVisible()
  await expect(page.getByText('Mesure supprimée', { exact: true })).toHaveCount(0)
})

test('un simple changement de fond ne relance pas le relevé quand l’IA est terminée', async ({ page }) => {
  const backend = await installerOutils(page, { avecMaison: true, iaFinie: true })
  const feuille = await ouvrirMetre(page)
  await expect(feuille.getByText('Mesurer avec l’IA', { exact: true })).toBeVisible()
  await expect.poll(() => backend.appelsOutils.filter((a) => a.nom === 'releve-lidar').length).toBeGreaterThan(0)
  // Une rafraîchissement lié à la fin de l’IA est légitime. Changer le fond ne l’est pas.
  await page.waitForTimeout(300)
  const avant = backend.appelsOutils.filter((a) => a.nom === 'releve-lidar').length
  await feuille.getByRole('button', { name: 'Passer au plan', exact: true }).click()
  await feuille.getByRole('button', { name: 'Passer à la photo', exact: true }).click()
  await page.waitForTimeout(300)
  expect(backend.inconnues).toEqual([])
  expect(backend.appelsOutils.filter((a) => a.nom === 'releve-lidar').length).toBe(avant)
})

test('le retour ferme la feuille sans quitter la vue Métrés', async ({ page }) => {
  const backend = await installerOutils(page)
  const feuille = await ouvrirMetre(page)
  await expect(feuille.getByRole('button', { name: 'Dessiner une surface', exact: true })).toBeVisible()
  await page.goBack()
  await expect(feuille).toBeHidden()
  await expect(page).toHaveURL(/vue=metres/)
  await expect(page.getByRole('heading', { name: 'Métrés', exact: true, level: 1 })).toBeVisible()
  expect(backend.erreursPage).toEqual([])
  expect(backend.inconnues).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
})

test('le panneau de dessin reste sans débordement à 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 })
  await installerOutils(page)
  const feuille = await ouvrirMetre(page)
  await expect(feuille.getByRole('button', { name: 'Dessiner une surface', exact: true })).toBeVisible()
  await expect.poll(() => feuille.getByRole('button', { name: 'Dessiner une surface', exact: true }).evaluate((bouton) => bouton.scrollWidth <= bouton.clientWidth)).toBe(true)
})

for (const type of ['surface', 'longueur'] as const) {
  test(`dessiner une ${type}, annuler un point puis enregistrer le tracé`, async ({ page }) => {
    const backend = await installerOutils(page, { avecPosition: true })
    const feuille = await ouvrirMetre(page)
    await feuille.getByRole('button', { name: type === 'surface' ? 'Dessiner une surface' : 'Mesurer une longueur', exact: true }).click()
    const carte = feuille.locator('.leaflet-container').first()
    const rect = await carte.boundingBox()
    expect(rect).not.toBeNull()
    for (const [x, y] of [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7]]) {
      await carte.click({ position: { x: rect!.width * x, y: rect!.height * y } })
    }
    await feuille.getByRole('button', { name: 'Défaire le dernier point', exact: true }).click()
    if (type === 'surface') {
      const apres = await carte.boundingBox()
      await carte.click({ position: { x: apres!.width * 0.5, y: apres!.height * 0.65 } })
    }
    await feuille.getByRole('textbox', { name: 'Nom du métré' }).fill(`Tracé démo ${type}`)
    await feuille.getByRole('button', { name: 'Garder', exact: true }).click()
    await expect(page.getByText('Métré enregistré', { exact: true })).toBeVisible()
    const requete = backend.appelsOutils.find((a) => a.nom === 'enregistrer_metre_by_token')!
    expect(requete.body.p_type).toBe(type)
    expect(requete.body.p_source).toBe('dessin')
    expect((requete.body.p_geometrie as Point[]).length).toBe(type === 'surface' ? 3 : 2)
    await feuille.getByText('Déjà enregistré (2)', { exact: true }).click()
    await expect(feuille.getByRole('listitem').filter({ hasText: `Tracé démo ${type}` })).toBeVisible()
    expect(backend.inconnues).toEqual([])
    expect(backend.erreursPage).toEqual([])
  })
}

test('corriger une mesure sur place et télécharger le CSV qui conserve le relevé initial', async ({ page }) => {
  const backend = await installerOutils(page, { avecMaison: true, avecReleve: true })
  const feuille = await ouvrirMetre(page)
  await feuille.getByRole('button', { name: 'Mesuré sur place', exact: true }).first().click()
  const champ = feuille.getByRole('textbox', { name: /Valeur mesurée sur place/ })
  await champ.fill('112,5')
  await champ.press('Enter')
  await expect(page.getByText('Valeur enregistrée', { exact: true })).toBeVisible()
  expect(backend.metrage[0]).toMatchObject({ cle: 'toit_surface', valeur_retenue: 112.5, retenue_par: 'artisan' })
  await expect(feuille.getByText('112,5 m²', { exact: true })).toBeVisible()
  const telechargement = page.waitForEvent('download')
  await feuille.getByRole('button', { name: 'Tableau CSV', exact: true }).click()
  const fichier = await telechargement
  expect(fichier.suggestedFilename()).toMatch(/\.csv$/)
  const csv = readFileSync((await fichier.path())!, 'utf8')
  expect(csv).toContain('Valeurs confirmées;Surface du toit;112,5;m²')
  expect(csv).toContain('Confirmé par l’artisan')
  expect(csv).toContain('Mesures initiales du dossier;Surface du toit;104;m²')
  expect(csv).toContain('Toiture;Total compté;')
  expect(csv).toContain('Confiance du relevé automatique : haute')
  expect(backend.inconnues).toEqual([])
  expect(backend.erreursPage).toEqual([])
})

test('lancer une IA fictive, lire sa progression puis reprendre après un échec', async ({ page }) => {
  const backend = await installerOutils(page, { avecMaison: true, parcoursIA: true })
  const feuille = await ouvrirMetre(page)
  await feuille.getByText('Analyse IA de la maison', { exact: false }).click()
  await feuille.getByRole('button', { name: 'Oui, c’est cette maison : mesurer avec l’IA', exact: true }).click()
  await expect(feuille.getByText(/Prise des photos$/)).toBeVisible()
  await expect(feuille.getByText('L’IA est occupée. Réessayez dans une minute.', { exact: true })).toBeVisible({ timeout: 15_000 })
  await feuille.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(feuille.getByText(/Prise des photos$/)).toBeVisible()
  await expect(feuille.getByText(/Prise des photos$/)).toBeHidden({ timeout: 15_000 })
  expect(backend.appelsOutils.filter((a) => a.nom === 'metre-ia' && a.body.action === 'lire')).toHaveLength(2)
  expect(backend.inconnues).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
  expect(backend.erreursPage).toEqual([])
})

test('ajouter une photo synthétique, lire puis retirer et remettre une ouverture au clavier', async ({ page }) => {
  const backend = await installerOutils(page, { avecMaison: true, avecReleve: true, photos: true })
  const feuille = await ouvrirMetre(page)
  await feuille.getByRole('button', { name: 'Façades', exact: true }).click()
  await expect(feuille).toBeVisible()
  await feuille.getByRole('button', { name: /^nord-ouest ·/ }).click()
  const prendre = feuille.getByRole('button', { name: 'Prendre une photo', exact: true })
  await expect(prendre).toBeVisible()
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 100; c.height = 100
    c.getContext('2d')!.fillRect(0, 0, 100, 100)
    return c.toDataURL('image/png').split(',')[1]
  })
  await feuille.locator('input[type=file]').setInputFiles({ name: 'facade-synthetique.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  const retirer = feuille.getByRole('button', { name: 'Retirer cette ouverture 1', exact: true })
  await expect(retirer).toBeVisible()
  await retirer.focus()
  await page.keyboard.press('Enter')
  const remettre = feuille.getByRole('button', { name: 'Remettre cette ouverture 1', exact: true })
  await expect(remettre).toBeVisible()
  await remettre.focus()
  await page.keyboard.press('Space')
  await expect(retirer).toBeVisible()
  expect(backend.appelsOutils.filter((a) => a.nom === 'upload-photo')).toHaveLength(1)
  expect(backend.appelsOutils.filter((a) => a.nom === 'facade-photo' && a.body.action === 'lire')).toHaveLength(1)
  expect(backend.appelsOutils.filter((a) => a.nom === 'facade-photo' && a.body.action === 'ecarter').map((a) => a.body.ecartee)).toEqual([true, false])
  expect(backend.inconnues).toEqual([])
  expect(backend.sortiesBloquees).toEqual([])
})

test('le relevé local construit une vue 3D et laisse revenir à la carte', async ({ page }, testInfo) => {
  const backend = await installerOutils(page, { avecMaison: true, avecReleve: true })
  const feuille = await ouvrirMetre(page)
  const vue = feuille.getByRole('img', { name: 'Maison en 3D', exact: true })
  await expect(vue).toBeVisible()
  await expect(vue.locator('canvas')).toBeVisible()
  await page.screenshot({ path: `test-results/artisan-review/metres-3d-${testInfo.project.name}.png`, fullPage: false })
  const telechargement = page.waitForEvent('download')
  await feuille.getByRole('button', { name: 'Modèle 3D (.glb)', exact: true }).click()
  const fichier = await telechargement
  expect(fichier.suggestedFilename()).toMatch(/\.glb$/)
  const glb = readFileSync((await fichier.path())!)
  expect(glb.subarray(0, 4).toString('ascii')).toBe('glTF')
  expect(glb.readUInt32LE(4)).toBe(2)
  expect(glb.readUInt32LE(8)).toBe(glb.length)
  await feuille.getByRole('button', { name: 'Revenir à la carte', exact: true }).click()
  await expect(vue).toBeHidden()
  await expect(feuille.getByRole('button', { name: 'Voir la maison en 3D', exact: true })).toBeVisible()
  expect(backend.inconnues).toEqual([])
  expect(backend.erreursPage).toEqual([])
})

for (const refuse of [false, true]) {
  test(`confirmer la visite façade par façade dans un seul lot ${refuse ? 'refusé sans succès trompeur' : 'valide'}`, async ({ page }) => {
    const backend = await installerOutils(page, { avecMaison: true, avecReleve: true, lotRefuse: refuse })
    const feuille = await ouvrirMetre(page)
    await feuille.getByRole('button', { name: 'Façades', exact: true }).click()
    await feuille.getByRole('button', { name: 'Je suis sur place', exact: true }).click()
    const facades = feuille.getByRole('button', { name: /^Façade (nord|sud|est|ouest)/ })
    const n = await facades.count()
    expect(n).toBeGreaterThan(1)
    for (let i = 0; i < n; i++) {
      await facades.nth(i).click()
      if (i === 0) {
        await feuille.getByLabel('Longueur mesurée', { exact: true }).fill('10')
        await feuille.getByLabel('Hauteur à la gouttière', { exact: true }).fill('6')
        await feuille.getByRole('button', { name: 'Une ouverture de plus', exact: true }).click()
      }
      await feuille.getByRole('button', { name: 'Façade vue', exact: true }).click()
    }
    await feuille.getByRole('button', { name: /^Confirmer :/ }).click()
    await expect(page.getByText(refuse ? 'Confirmation non enregistrée' : 'Façades confirmées sur place', { exact: true })).toBeVisible()
    const appels = backend.appelsOutils.filter((a) => a.nom.startsWith('corriger_metrage'))
    expect(appels).toHaveLength(1)
    expect(appels[0].nom).toBe('corriger_metrages_by_token')
    expect(appels[0].body.p_corrections).toEqual(expect.arrayContaining([expect.objectContaining({ cle: 'hauteur_murs', valeur: 6 }), expect.objectContaining({ cle: 'ouvertures', valeur: 1 })]))
    expect(appels[0].body.p_note).toContain('L 10 m, H 6 m')
    if (refuse) {
      expect(backend.metrage).toEqual([])
      await expect(page.getByText(/Aucune valeur de ce lot n’a été modifiée/)).toBeVisible()
      await expect(page.getByText('Façades confirmées sur place', { exact: true })).toHaveCount(0)
    }
    expect(backend.inconnues).toEqual([])
  })
}

test('la recherche d’adresse distingue une panne puis récupère après réessai', async ({ page }) => {
  const backend = await installerOutils(page)
  let tentatives = 0
  await page.route('https://api-adresse.data.gouv.fr/**', (route) => {
    tentatives++
    return route.fulfill({ status: tentatives === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(tentatives === 1 ? { error: 'panne fictive' } : { features: [{ properties: { label: '12 rue de démonstration', type: 'street' }, geometry: { coordinates: [2.35, 48.856] } }] }) })
  })
  const feuille = await ouvrirMetre(page)
  await feuille.getByRole('button', { name: 'Chercher l’adresse', exact: true }).click()
  await feuille.getByRole('textbox', { name: 'Rechercher une adresse' }).fill('rue démonstration')
  await expect(feuille.getByText('La recherche d’adresse est indisponible.', { exact: true })).toBeVisible()
  await feuille.getByRole('button', { name: 'Réessayer la recherche', exact: true }).click()
  await expect(feuille.getByRole('button', { name: /12 rue de démonstration/ })).toBeVisible()
  expect(tentatives).toBe(2)
  expect(backend.sortiesBloquees).toEqual([])
})

test('le délai IA arrête l’attente puis vérifie le résultat sans nouvelle lecture payante', async ({ page }) => {
  const debut = new Date('2026-11-08T12:00:00Z')
  await page.clock.install({ time: debut })
  const backend = await installerOutils(page, { avecMaison: true, parcoursIA: true, iaBloquee: true })
  const feuille = await ouvrirMetre(page)
  await feuille.getByText('Analyse IA de la maison', { exact: false }).click()
  await feuille.getByRole('button', { name: 'Oui, c’est cette maison : mesurer avec l’IA', exact: true }).click()
  await expect(feuille.getByText(/Prise des photos$/)).toBeVisible()
  await page.clock.setSystemTime(new Date(debut.getTime() + 361_000))
  await page.clock.runFor(4_000)
  await expect(feuille.getByText('L’analyse prend plus de temps que prévu.', { exact: true })).toBeVisible()
  await expect(feuille.getByText(/Prise des photos$/)).toHaveCount(0)
  const avant = backend.appelsOutils.filter((a) => a.nom === 'metre-ia').length
  await page.clock.runFor(15_000)
  expect(backend.appelsOutils.filter((a) => a.nom === 'metre-ia').length).toBe(avant)
  backend.terminerIA()
  await feuille.getByRole('button', { name: 'Réessayer la vérification', exact: true }).click()
  await expect(feuille.getByText('L’analyse prend plus de temps que prévu.', { exact: true })).toHaveCount(0)
  await expect(feuille.getByText(/Prise des photos$/)).toHaveCount(0)
  expect(backend.appelsOutils.filter((a) => a.nom === 'metre-ia' && a.body.action === 'lire')).toHaveLength(1)
  expect(backend.erreursPage).toEqual([])
  expect(backend.inconnues).toEqual([])
})

test('le délai LiDAR cesse le spinner et permet de récupérer le relevé terminé', async ({ page }) => {
  const debut = new Date('2026-11-08T12:00:00Z')
  await page.clock.install({ time: debut })
  const backend = await installerOutils(page, { avecMaison: true, avecReleve: true, releveBloque: true })
  const feuille = await ouvrirMetre(page)
  await expect(feuille.getByText(/Relevé précis en cours/)).toBeVisible()
  await page.clock.setSystemTime(new Date(debut.getTime() + 181_000))
  await page.clock.runFor(5_000)
  await expect(feuille.getByText('Le relevé prend plus de temps que prévu.', { exact: true })).toBeVisible()
  await expect(feuille.getByText(/Relevé précis en cours/)).toHaveCount(0)
  const avant = backend.appelsOutils.filter((a) => a.nom === 'releve-lidar').length
  await page.clock.runFor(15_000)
  expect(backend.appelsOutils.filter((a) => a.nom === 'releve-lidar').length).toBe(avant)
  backend.terminerReleve()
  await feuille.getByRole('button', { name: 'Réessayer le relevé', exact: true }).click()
  await expect(feuille.getByText('Le relevé prend plus de temps que prévu.', { exact: true })).toHaveCount(0)
  await expect(feuille.getByText('Pans du toit', { exact: true })).toBeVisible()
  expect(backend.erreursPage).toEqual([])
  expect(backend.inconnues).toEqual([])
})
