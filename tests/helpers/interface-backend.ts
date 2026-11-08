import type { Page } from '@playwright/test'

// Identités et données inventées, exclusivement réservées aux tests locaux.
const USER_ID = '11111111-1111-4111-8111-111111111111'
const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'test@celexia.example', email_confirmed_at: '2026-01-01T10:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T10:00:00Z' }
const tokenPart = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const access_token = `${tokenPart({ alg: 'HS256', typ: 'JWT' })}.${tokenPart({ sub: USER_ID, aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.test-signature`
const session = { access_token, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user }

export const artisans = [
  { id: 'artisan-martin', nom: 'Martin', prenom: 'Julien', societe: 'Atelier Martin', metiers: ['Couverture'], ville: 'Lyon', telephone: '0600000001', source: 'agence', partenaire_at: null },
  { id: 'artisan-bernard', nom: 'Bernard', prenom: 'Camille', societe: 'Bernard Électricité', metiers: ['Électricité'], ville: 'Nantes', telephone: '0600000002', source: 'auto:site', partenaire_at: null },
  { id: 'artisan-robert', nom: 'Robert', prenom: 'Alexandre', societe: 'Robert Rénovation', metiers: ['Rénovation', 'Peinture'], ville: 'Rennes', telephone: '0600000003', source: 'agence', partenaire_at: '2026-09-01T10:00:00Z' },
].map((artisan) => ({
  email: 'artisan@example.test', adresse: null, code_postal: '69001', latitude: null, longitude: null,
  specificites: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', sous_metiers: [],
  departements_couverts: [], zones_couvertes: [], ecarte_at: null, ecarte_motif: null,
  taux_commission: 0.15, contrat_externe: false, siren: null, assurance_decennale_url: null,
  assurance_rc_pro_url: null, assurances_validees_at: null, ...artisan,
}))

export const projets = [
  { id: 'projet-1', client_nom: 'Sophie Laurent', client_ville: 'Lyon', metiers: ['Couverture'], statut: 'nouveau', estimation_interne: 18500, artisan_id: null },
  { id: 'projet-2', client_nom: 'Pierre Moreau', client_ville: 'Rennes', metiers: ['Rénovation'], statut: 'a_rappeler', estimation_interne: 24000, artisan_id: 'artisan-robert' },
  { id: 'projet-3', client_nom: 'Émilie Dubois', client_ville: 'Lyon', metiers: ['Couverture'], statut: 'devis_envoye', estimation_interne: 12800, montant_devis: 12800, artisan_id: 'artisan-martin' },
  { id: 'projet-4', client_nom: 'Nicolas Petit', client_ville: 'Nantes', metiers: ['Électricité'], statut: 'rdv_pris', estimation_interne: 7500, artisan_id: 'artisan-bernard' },
  { id: 'projet-5', client_nom: 'Claire Bonnet', client_ville: 'Rennes', metiers: ['Rénovation'], statut: 'devis_signe', montant_devis_signe: 28600, artisan_id: 'artisan-robert' },
  { id: 'projet-6', client_nom: 'Antoine Lefèvre', client_ville: 'Lyon', metiers: ['Couverture'], statut: 'devis_signe', montant_devis_signe: 17000, artisan_id: 'artisan-martin' },
].map((projet, index) => ({
  client_telephone: `060000001${index}`, client_email: null, client_adresse: null, client_code_postal: '69001',
  created_at: `2026-11-0${6 - index}T10:00:00Z`, updated_at: '2026-11-06T10:00:00Z',
  deleted_at: null, assigne_a: null, origine: 'neuf', montant_devis: null, montant_devis_signe: null,
  estimation_interne: null, commission_encaissee: false, metier: projet.metiers[0], sous_metier: null,
  taux_commission: 0.15, ...projet,
  artisan: artisans.find((a) => a.id === projet.artisan_id) ?? null,
}))

const kpi = {
  leads_transmis: 5, leads_actifs: 3, leads_rendus: 0, artisans_sollicites: 3,
  jamais_ouverts: 1, contactes: 4, rdv_pris: 3, devis_envoyes: 3, signes: 2, perdus: 0,
  taux_ouverture_sur_transmis: 80, taux_devis_sur_transmis: 60, taux_signature_sur_devis: 100, taux_conversion_global: 100,
  delai_ouverture_j: 1.2, delai_signature_j: 5, delai_devis_signe_j: 2, delai_signature_n: 2,
  ca_signe: 45600, panier_moyen: 22800, panier_median: 22800, devis_moyen_envoye: 19466.67,
  devis_median_envoye: 17000, pipe_chiffre: 12800, montant_perdu: 0,
  commission_acquise: 6840, commission_encaissee: 4000, commission_a_encaisser: 2840,
  taux_commission_moyen: 0.15, periode_debut: '2026-11-01', periode_fin: null,
}
const rpc: Record<string, unknown> = {
  kpi_agence: kpi,
  kpi_par_artisan: [
    { artisan_id: 'artisan-robert', artisan_nom: 'Robert Rénovation', leads_transmis: 2, rendus: 0, jamais_ouverts: 1, devis_envoyes: 1, signes: 1, perdus: 0, taux_conversion_global: 100, ca_signe: 28600, panier_moyen: 28600, delai_signature_j: 5 },
    { artisan_id: 'artisan-martin', artisan_nom: 'Atelier Martin', leads_transmis: 2, rendus: 0, jamais_ouverts: 0, devis_envoyes: 2, signes: 1, perdus: 0, taux_conversion_global: 100, ca_signe: 17000, panier_moyen: 17000, delai_signature_j: 5 },
  ],
  a_traiter: { leads_neufs: 1, leads_neufs_vieux: 0, a_encaisser_n: 1, a_encaisser_montant: 2840, a_reprendre: 0, repris_en_cours: 0, a_verser: 0, chez_artisan: 3, chez_artisan_dormants: 0, metrages_a_verifier: 0 },
  action_du_jour: { leads: 1, contrats: 1, rdv: 1, devis: 1, commissions_n: 1, commissions_total: 2840 },
  ca_signe_par_mois: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((mois) => ({ mois, ca: mois === '2026-11' ? 45600 : 0, commission: mois === '2026-11' ? 6840 : 0 })),
  qualite_leads: {
    par_metier: [
      { metier: 'Couverture', transmis: 2, gagnes: 1, refuses_artisan: 0, perdus_client: 0, panier_moyen: 17000, taux_signature: 100 },
      { metier: 'Rénovation', transmis: 2, gagnes: 1, refuses_artisan: 0, perdus_client: 0, panier_moyen: 28600, taux_signature: 100 },
      { metier: 'Électricité', transmis: 1, gagnes: 0, refuses_artisan: 0, perdus_client: 0, panier_moyen: 0, taux_signature: null },
    ],
    par_departement: [{ dep: '69', transmis: 2, gagnes: 1, refuses_artisan: 0, jamais_contactes: 0 }],
    total_transmis: 5, total_refuses_artisan: 0,
  },
  stats_artisans: artisans.map((a) => ({ id: a.id, nom: a.nom, en_cours: 1, gagnes: a.id === 'artisan-bernard' ? 0 : 1, ca_signe: a.id === 'artisan-robert' ? 28600 : a.id === 'artisan-martin' ? 17000 : 0, commission: 0, perdus: 0, taux: 100, delai_h: 24 })),
  jeton_espace_artisan: null,
  scoring_artisan: null,
}

export async function installerBackend(page: Page, options: { connecte?: boolean; role?: 'fondateur' | 'commercial'; projetsEnErreur?: boolean; projetsVides?: boolean; refuserCreation?: boolean } = {}) {
  const requetesNonSimulees: string[] = []
  const erreursPage: string[] = []
  const appelsFonctions: string[] = []
  const creationsProjets: Record<string, unknown>[] = []
  page.on('pageerror', (error) => erreursPage.push(error.message))
  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00Z'))
  // Bloque les sorties réseau hors serveur local, y compris les fontes CDN.
  // Le backend fictif ne reçoit jamais une requête réelle.
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:5180') return route.continue()
    if (url.origin !== 'https://crm-test.supabase.co') return route.abort('blockedbyclient')
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/v1/token')) return json(session)
    if (url.pathname === '/auth/v1/user') return json(user)
    if (url.pathname === '/auth/v1/logout') return json({})
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const nom = url.pathname.split('/').at(-1)!
      if (Object.hasOwn(rpc, nom)) return json(rpc[nom])
      // Le tableau de bord commercial peut être brièvement chargé avant la fiche membre.
      if (['kpi_commercial', 'mes_stats_commercial', 'mes_kpi', 'mes_reprises', 'a_reprendre'].includes(nom)) return json([])
      requetesNonSimulees.push(url.pathname)
      return json(null)
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      appelsFonctions.push(url.pathname)
      return json({ error: 'Fonction désactivée dans les tests locaux' }, 503)
    }
    const table = url.pathname.split('/').at(-1)
    const unique = request.headers().accept?.includes('vnd.pgrst.object')
    const id = url.searchParams.get('id')?.replace(/^eq\./, '')
    const resultat = (rows: unknown[]) => json(unique ? rows[0] ?? null : rows)
    if (table === 'membres') return resultat([{ id: 'membre-test', user_id: USER_ID, nom: 'Équipe de démonstration', role: options.role ?? 'fondateur', actif: true, peut_creer_lead: false, peut_creer_artisan: false, peut_attribuer: true, peut_voir_commissions: false }])
    if (table === 'projets') {
      if (request.method() === 'POST') {
        creationsProjets.push(request.postDataJSON() as Record<string, unknown>)
        if (!options.refuserCreation) requetesNonSimulees.push('POST /rest/v1/projets')
        // Refus volontaire : valide le submit clavier et la conservation du
        // formulaire en cas d'échec, sans prétendre simuler toute la fiche.
        return json({ code: 'TEST_WRITE_REJECTED', message: 'Écriture simulée refusée pour ce test' }, 400)
      }
      if (options.projetsEnErreur) return json({ code: 'TEST_QUERY_ERROR', message: 'Chargement refusé par le backend de test' }, 400)
      if (options.projetsVides || url.searchParams.get('deleted_at')?.startsWith('not.')) return resultat([])
      const artisanId = url.searchParams.get('artisan_id')?.replace(/^eq\./, '')
      return resultat(projets.filter((p) => (!id || p.id === id) && (!artisanId || p.artisan_id === artisanId)))
    }
    if (table === 'artisans') return resultat(url.searchParams.has('contrat_externe') ? [] : artisans.filter((a) => !id || a.id === id))
    if (table === 'affectations') return resultat(projets.filter((p) => p.artisan_id).map((p) => ({ projet_id: p.id, artisan_id: p.artisan_id, statut: p.statut })))
    if (table === 'contrats') return resultat(url.searchParams.has('artisan_id') ? [] : [{ artisan_id: 'artisan-martin' }, { artisan_id: 'artisan-robert' }])
    if (['notifications', 'retrocessions', 'app_settings', 'ponts_artisan', 'pont_sortant', 'pont_entrant', 'notes', 'taches'].includes(table ?? '')) return resultat([])
    requetesNonSimulees.push(url.pathname)
    return resultat([])
  })
  if (options.connecte !== false) {
    await page.addInitScript((value) => localStorage.setItem('sb-crm-test-auth-token', JSON.stringify(value)), session)
  }
  return { requetesNonSimulees, erreursPage, appelsFonctions, creationsProjets }
}
