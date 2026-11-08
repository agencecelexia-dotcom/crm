import type { Page } from '@playwright/test'
import type { Devis, EspaceArtisan, ProjetEspace, StatsEspaceArtisan, Suivi } from '../../src/types/database'
import type { EtatChiffrage } from '../../src/features/assurances/use-assurances'
import type { IdentiteArtisan } from '../../src/features/devis/use-identite'
import type { ModeleDevis, PrixArtisan } from '../../src/features/devis/use-devis'

// Identités, coordonnées et jetons inventés. Ce jeton ne fonctionne qu'avec
// l'interception ci-dessous : aucune donnée ni URL d'un artisan réel.
export const TOKEN_ARTISAN_DEMO = 'demo-artisan-local-sans-donnees-reelles'
export const URL_ARTISAN_DEMO = `/artisan/${TOKEN_ARTISAN_DEMO}`
const MAINTENANT = '2026-11-08T10:00:00Z'

const basesProjets: Partial<ProjetEspace>[] = [
  { client_nom: 'Sophie Laurent', client_ville: 'Lyon', statut: 'artisan_assigne', etape: null, description: 'Réfection de la couverture en tuiles, environ 110 m². Accès par la cour.', budget_estime: 18500, recu_le: '2026-11-07T14:00:00Z', non_lus: 1 },
  { client_nom: 'Pierre Moreau', client_ville: 'Villeurbanne', statut: 'contacte', etape: 'contacte', description: 'Isolation des combles perdus. Première visite à organiser.', budget_estime: 7200, recu_le: '2026-11-06T08:00:00Z', rappel_le: '2026-11-07T09:00:00Z' },
  { client_nom: 'Émilie Dubois', client_ville: 'Bron', statut: 'rdv_pris', etape: 'rdv_pris', description: 'Recherche de fuite et reprise du solin autour de la cheminée.', budget_estime: 3400, recu_le: '2026-11-04T08:00:00Z', date_rdv: '2026-11-10T13:00:00Z' },
  { client_nom: 'Nicolas Petit', client_ville: 'Écully', statut: 'devis_envoye', etape: 'devis_envoye', description: 'Remplacement de gouttières et descentes en zinc.', montant_devis: 8200, devis_depose: true, recu_le: '2026-10-17T08:00:00Z', derniere_activite: '2026-10-20T10:00:00Z' },
  { client_nom: 'Claire Bonnet', client_ville: 'Caluire-et-Cuire', statut: 'devis_signe', etape: 'devis_signe', issue: 'gagne', description: 'Rénovation de la toiture et remplacement des fenêtres de toit.', montant_devis: 24800, montant_devis_signe: 24800, devis_depose: true, devis_signe_depose: true, commission: 3720, recu_le: '2026-10-12T08:00:00Z' },
  { client_nom: 'Antoine Lefèvre', client_ville: 'Tassin-la-Demi-Lune', statut: 'termine', etape: 'termine', issue: 'gagne', description: 'Réparation de toiture terminée et réceptionnée.', montant_devis: 12600, montant_devis_signe: 12600, devis_depose: true, devis_signe_depose: true, commission: 1890, commission_encaissee: true, recu_le: '2026-09-18T08:00:00Z' },
]

export const chantiersDemo: ProjetEspace[] = basesProjets.map((projet, index) => ({
  id: `chantier-demo-${index + 1}`, token: `affectation-demo-${index + 1}`,
  statut: 'artisan_assigne', metier: 'Couverture', metiers: ['Couverture'], sous_metier: null,
  description: null, budget_estime: null, montant_devis: null, montant_devis_signe: null,
  commission: null, commission_encaissee: false, client_ville: 'Lyon', photos: [],
  devis_depose: false, devis_signe_depose: false, devis_url: null, devis_signe_url: null,
  issue: 'en_cours', etape: null, en_attente_depuis: null, rappel_le: null,
  recu_le: MAINTENANT, derniere_activite: '2026-11-06T10:00:00Z', date_rdv: null, non_lus: 0,
  client_nom: null, client_telephone: `060000010${index}`, client_email: `client-${index}@example.test`,
  client_adresse: `${12 + index} rue des Ateliers`, client_code_postal: '69003',
  suivis: index === 0 ? [{ id: 'suivi-demo-initial', auteur: 'agence', type: 'note', statut: null, message: 'La cliente est disponible en fin de journée. Merci de la rappeler.', created_at: '2026-11-07T14:15:00Z', lu_at: null }] : [],
  ...projet,
}))

const statsDemo: StatsEspaceArtisan = {
  funnel: {
    contacte: { atteint: 5, actif: 3, gagne: 2, perdu: 0 },
    rdv_pris: { atteint: 4, actif: 2, gagne: 2, perdu: 0 },
    devis_envoye: { atteint: 3, actif: 1, gagne: 2, perdu: 0 },
    devis_signe: { atteint: 2, actif: 0, gagne: 2, perdu: 0 },
    termine: { atteint: 1, actif: 0, gagne: 1, perdu: 0 },
  },
  signatures_prouvees: 2, signatures_declarees_sans_preuve: 0, leads_recus: 6,
  en_cours: 4, gagnes: 2, perdus: 0, contactes: 5, rdv: 4, devis_envoyes: 3,
  devis_signes: 2, termines: 1, montant_devis_total: 45600, panier_moyen: 18700,
  panier_median: 18700, ca_signe: 37400, pipe_en_cours: 8200, montant_perdu: 0,
  commission_due: 3720, commission_reglee: 1890, tranches: 2,
  taux_contact: 83, taux_rdv: 67, taux_devis: 50, taux_signature: 100,
  taux_refus_avant_devis: 0, delai_contact_j: 1, delai_contact_n: 5,
  delai_devis_j: 5, delai_devis_n: 3, delai_signature_j: null, delai_signature_n: 2,
  rappels_echus: 1, jamais_contactes_48h: 0, devis_sans_reponse_15j: 1,
}

const espaceDemo: EspaceArtisan = {
  artisan: {
    id: 'artisan-demo-martin', nom: 'Martin', prenom: 'Julien', societe: 'Atelier Martin Couverture',
    adresse: '8 rue des Compagnons', code_postal: '69003', ville: 'Lyon', siren: '000000000',
    forme_juridique: 'SARL', telephone: '0600000099', email: 'atelier@example.test', representant: 'Julien Martin',
  },
  engagement: { token: 'engagement-demo', statut: 'signe', contenu: 'Contrat fictif de démonstration.\nCommission : 15 % du devis signé.\nAucune valeur contractuelle.', signataire_nom: 'Julien Martin', signed_at: '2026-09-01T10:00:00Z', signature_data: null, apporteur_signature: null },
  signe: true, contrat_externe: false, projets: chantiersDemo, projets_perdus: [], stats: statsDemo,
}

const assuranceDemo: EtatChiffrage = {
  peut_chiffrer: true, validees_le: '2026-09-02T10:00:00Z', taux_commission: 0.15,
  decennale: { deposee: true, assureur: 'Assureur Démonstration', police: 'DEMO-DEC-2026', echeance: '2027-08-31', expiree: false },
  rc_pro: { deposee: true, assureur: 'Assureur Démonstration', police: 'DEMO-RCP-2026', echeance: '2027-08-31', expiree: false },
}

const identiteDemo: IdentiteArtisan = {
  societe: espaceDemo.artisan.societe, adresse: espaceDemo.artisan.adresse, code_postal: '69003', ville: 'Lyon',
  telephone: '0600000099', email: 'atelier@example.test', siren: '000000000', forme_juridique: 'SARL',
  capital_social: '10000', ville_immatriculation: 'Lyon', representant: 'Julien Martin', logo_url: null,
  tva_intracom: 'FR00000000000', code_ape: '4391B', iban: null, bic: null,
  mediateur_nom: 'Médiateur fictif', mediateur_url: 'https://example.test/mediation',
  cgv: 'Conditions de démonstration — aucune valeur contractuelle.', cgv_personnalisees: false,
  conditions_paiement: 'Acompte de 30 %, solde à réception.', garantie_zone: 'France métropolitaine',
  acompte_defaut: 30, tva_mode_defaut: 'normal',
  assurance: { decennale_assureur: 'Assureur Démonstration', decennale_police: 'DEMO-DEC-2026', decennale_echeance: '2027-08-31', rc_pro_assureur: 'Assureur Démonstration', rc_pro_police: 'DEMO-RCP-2026' },
  manquants: [],
}

const devisDemo: Devis[] = [
  { id: 'devis-demo-1', numero: 'DEV-2026-014', client_nom: 'Nicolas Petit', objet: 'Gouttières en zinc', total: 8200, statut: 'envoye', pdf_url: null, date_devis: '2026-10-20', sent_at: '2026-10-20T10:00:00Z', projet_id: 'chantier-demo-4' },
  { id: 'devis-demo-2', numero: 'DEV-2026-015', client_nom: 'Sophie Laurent', objet: 'Réfection de couverture', total: 18500, statut: 'brouillon', pdf_url: null, date_devis: '2026-11-07', sent_at: null, projet_id: 'chantier-demo-1' },
]

const prixDemo: PrixArtisan[] = [{ id: 'prix-demo-tuiles', designation: 'Dépose et remplacement des tuiles', unite: 'm²', prix_unitaire: 85, cout_unitaire: 48, metier: 'Couverture', utilisations: 4 }]
const modelesDemo: ModeleDevis[] = [{ id: 'modele-demo-toiture', nom: 'Réfection de couverture', metier: 'Couverture', nb_lignes: 1, source: 'perso', lignes: [{ designation: 'Dépose et remplacement des tuiles', unite: 'm²', quantite: 110, prix_unitaire: 85, cout_unitaire: 48, tva_taux: 10 }] }]

interface OptionsBackendArtisan {
  signe?: boolean
  lienInvalide?: boolean
  espaceEnErreur?: boolean
  devisVides?: boolean
  devisEnErreur?: boolean
  chiffrageEnErreur?: boolean
  assurancesEnAttente?: boolean
  commissionsVides?: boolean
  commissionsEnErreur?: boolean
}

export async function installerBackendArtisan(page: Page, options: OptionsBackendArtisan = {}) {
  // Le serveur local est partagé : même la sauvegarde d’un rapport Markdown
  // peut provoquer un full-reload Vite et fermer un formulaire en cours.
  // Neutralise seulement le WebSocket HMR de ce serveur de test, sans
  // modifier les requêtes applicatives ni masquer leurs erreurs.
  await page.routeWebSocket('ws://127.0.0.1:5180/**', (ws) => { ws.onMessage(() => undefined) })
  const espace = structuredClone(espaceDemo)
  const identite = structuredClone(identiteDemo)
  const assurances = structuredClone(assuranceDemo)
  const etat = { ...options }
  const requetesNonSimulees: string[] = []
  const sortiesBloquees: string[] = []
  const erreursPage: string[] = []
  const appels: { nom: string; payload: Record<string, unknown> }[] = []
  const mutations: { nom: string; payload: Record<string, unknown> }[] = []
  if (options.signe === false) {
    espace.signe = false
    espace.engagement.statut = 'envoye'
    espace.engagement.signed_at = null
    espace.engagement.signataire_nom = null
    // Coordonnées volontairement présentes : vérifie aussi le verrou UI,
    // indépendamment du masquage normalement appliqué par le serveur.
  }
  if (options.assurancesEnAttente) {
    assurances.peut_chiffrer = false
    assurances.validees_le = null
  }
  await page.clock.setFixedTime(new Date(MAINTENANT))
  page.on('pageerror', (error) => erreursPage.push(error.message))
  // Interception au niveau contexte : protège aussi les nouveaux onglets.
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:5180') return route.continue()
    if (url.origin !== 'https://crm-test.supabase.co') {
      sortiesBloquees.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const indisponible = () => json({ code: 'DEMO_INDISPONIBLE', message: 'Service de démonstration temporairement indisponible' }, 503)
    if (!url.pathname.startsWith('/rest/v1/rpc/')) {
      requetesNonSimulees.push(`${request.method()} ${url.pathname}`)
      return json({ error: 'Aucune API réelle autorisée dans cette démonstration' }, 501)
    }
    const nom = url.pathname.split('/').at(-1)!
    const payload = request.postDataJSON() as Record<string, unknown>
    appels.push({ nom, payload })
    const chantier = espace.projets.find((p) => p.token === payload.p_token)
    switch (nom) {
      case 'get_espace_artisan':
        if (etat.espaceEnErreur) return indisponible()
        return json(etat.lienInvalide ? null : espace)
      case 'etat_chiffrage_by_token':
        if (etat.chiffrageEnErreur) return indisponible()
        return json(assurances)
      case 'capacites_devis_by_token': return json({ ok: true, version: 2, sauvegarde_idempotente: true, revisions: true })
      case 'list_devis_by_token':
        if (etat.devisEnErreur) return indisponible()
        return json(etat.devisVides ? [] : devisDemo)
      case 'identite_by_token': return json(identite)
      case 'prix_artisan_by_token': return json(prixDemo)
      case 'modeles_by_token': return json(modelesDemo)
      case 'etats_metrage_by_token':
        return json({ ok: true, chantiers: [{ affectation_token: 'affectation-demo-1', retenues: 2, a_verifier: 0 }, { affectation_token: 'affectation-demo-3', retenues: 0, a_verifier: 1 }] })
      case 'releve_commissions_by_token':
        if (etat.commissionsEnErreur) return indisponible()
        return json({ taux_contractuel: 0.15, total_du: etat.commissionsVides ? 0 : 3720, total_regle: etat.commissionsVides ? 0 : 1890, lignes: etat.commissionsVides ? [] : espace.projets.filter((p) => p.commission).map((p) => ({ projet_id: p.id, client: p.client_nom, ville: p.client_ville, metier: p.metier, assiette: p.montant_devis_signe, taux: 0.15, commission: p.commission, reglee: p.commission_encaissee, date_signature: '2026-10-28', devis_url: null })) })
      case 'documents_projet_par_token': return json([])
      case 'marquer_lu_by_token':
        if (chantier) {
          chantier.suivis.forEach((s) => { if (s.auteur === 'agence') s.lu_at = MAINTENANT })
          chantier.non_lus = 0
        }
        return json({ ok: true })
      case 'add_suivi_by_token': {
        mutations.push({ nom, payload })
        if (!chantier) return json({ ok: false, error: 'Jeton fictif inconnu' })
        const statut = payload.p_statut as Suivi['statut']
        if (statut) chantier.statut = statut
        chantier.suivis.push({ id: `suivi-demo-${mutations.length}`, auteur: 'artisan', type: statut ? 'statut' : 'note', statut, message: typeof payload.p_message === 'string' ? payload.p_message : null, created_at: MAINTENANT })
        chantier.derniere_activite = MAINTENANT
        return json({ ok: true })
      }
      case 'enregistrer_identite_by_token':
        mutations.push({ nom, payload })
        Object.assign(identite, payload.p_payload)
        return json({ ok: true })
      default:
        requetesNonSimulees.push(`${request.method()} ${url.pathname}`)
        return json({ error: 'RPC non couverte par les fixtures locales' }, 501)
    }
  })
  return { espace, etat, appels, mutations, requetesNonSimulees, sortiesBloquees, erreursPage }
}
