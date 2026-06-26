// ------------------------------------------------------------
//  Recherche d'entreprise via l'API publique de l'État (gratuite, sans clé).
//  https://recherche-entreprises.api.gouv.fr — pour auto-remplir les infos
//  société de l'artisan (raison sociale, SIREN, forme juridique, adresse, dirigeant).
// ------------------------------------------------------------

export interface ResultatEntreprise {
  siren: string
  raison_sociale: string
  forme_juridique: string // libellé (mappé depuis le code INSEE)
  adresse: string
  code_postal: string
  ville: string
  representant: string
  qualite_representant: string
}

// Mappe le code "catégorie juridique" INSEE vers un libellé lisible.
// Quelques codes exacts + repli par préfixe ; sinon chaîne vide (saisie manuelle).
function formeJuridique(code: string | null | undefined): string {
  if (!code) return ''
  const exacts: Record<string, string> = {
    '1000': 'Entrepreneur individuel',
    '5410': 'SARL',
    '5499': 'SARL',
    '5710': 'SAS',
    '5720': 'SASU',
    '5505': 'SA',
    '6540': 'SCI',
    '6901': 'Autre personne physique',
  }
  if (exacts[code]) return exacts[code]
  if (code.startsWith('1')) return 'Entrepreneur individuel'
  if (code.startsWith('54')) return 'SARL'
  if (code.startsWith('55')) return 'SA'
  if (code.startsWith('57')) return 'SAS'
  if (code.startsWith('65')) return 'Société civile'
  return ''
}

interface ApiDirigeant {
  nom?: string
  prenoms?: string
  qualite?: string
  denomination?: string
}
interface ApiResult {
  siren: string
  nom_complet?: string
  nom_raison_sociale?: string
  nature_juridique?: string
  siege?: { adresse?: string; code_postal?: string; libelle_commune?: string }
  dirigeants?: ApiDirigeant[]
}

/** Recherche des entreprises par nom ou SIREN/SIRET. Renvoie jusqu'à 8 résultats. */
export async function rechercherEntreprises(
  requete: string,
): Promise<ResultatEntreprise[]> {
  const q = requete.trim()
  if (q.length < 3) return []
  const url = new URL('https://recherche-entreprises.api.gouv.fr/search')
  url.searchParams.set('q', q)
  url.searchParams.set('per_page', '8')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error('Recherche entreprise indisponible')
  const data = (await res.json()) as { results?: ApiResult[] }

  return (data.results ?? []).map((r) => {
    const d = r.dirigeants?.[0]
    const representant = d
      ? d.denomination || [d.prenoms, d.nom].filter(Boolean).join(' ')
      : ''
    return {
      siren: r.siren,
      raison_sociale: r.nom_raison_sociale || r.nom_complet || '',
      forme_juridique: formeJuridique(r.nature_juridique),
      adresse: r.siege?.adresse || '',
      code_postal: r.siege?.code_postal || '',
      ville: r.siege?.libelle_commune || '',
      representant: capitaliser(representant),
      qualite_representant: d?.qualite || '',
    }
  })
}

// "JOEL BATONON" → "Joel Batonon" (les API renvoient souvent en majuscules)
function capitaliser(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s-])([a-zà-ÿ])/g, (_, sep, c) => sep + c.toUpperCase())
}

// ------------------------------------------------------------
//  Solidité / solvabilité (indicatif) — calculée depuis la MÊME API gratuite.
//  Signaux : entreprise active/cessée, ancienneté, taille, forme juridique,
//  label RGE, et finances (CA/résultat net) quand l'entreprise dépose ses comptes
//  (rare pour les petits artisans). Ce n'est PAS un score de crédit : pas de
//  procédures collectives ni d'impayés (→ BODACC gratuit ou Pappers payant).
// ------------------------------------------------------------
export interface SoliditeEntreprise {
  trouve: boolean
  active: boolean
  raison_sociale: string
  date_creation: string | null
  anciennete_annees: number | null
  forme: string
  est_societe: boolean // responsabilité limitée (SARL/SAS/SA…) vs entreprise individuelle
  categorie: string | null // PME / ETI / GE
  a_des_salaries: boolean
  est_rge: boolean
  ca: number | null
  resultat_net: number | null
  annee_finances: string | null
  score: number | null // /5 (null si entreprise introuvable)
  resume: string
}

interface ApiFinance {
  ca?: number
  chiffre_d_affaires?: number
  resultat_net?: number
}
interface ApiSolidite extends ApiResult {
  etat_administratif?: string
  date_creation?: string
  tranche_effectif_salarie?: string
  categorie_entreprise?: string
  finances?: Record<string, ApiFinance> | null
  complements?: { est_rge?: boolean }
}

/** Récupère et score la solidité d'une entreprise via son SIREN. */
export async function soliditeEntreprise(siren: string): Promise<SoliditeEntreprise | null> {
  const s = (siren || '').replace(/\D/g, '').slice(0, 9)
  if (s.length < 9) return null

  const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${s}&per_page=1`)
  if (!res.ok) throw new Error('API entreprise indisponible')
  const data = (await res.json()) as { results?: ApiSolidite[] }
  const r = data.results?.[0]
  if (!r) {
    return {
      trouve: false, active: false, raison_sociale: '', date_creation: null,
      anciennete_annees: null, forme: '', est_societe: false, categorie: null,
      a_des_salaries: false, est_rge: false, ca: null, resultat_net: null,
      annee_finances: null, score: null, resume: 'Entreprise introuvable',
    }
  }

  const active = r.etat_administratif === 'A'
  const anciennete = r.date_creation
    ? Math.floor((Date.now() - new Date(r.date_creation).getTime()) / (365.25 * 864e5))
    : null
  const forme = formeJuridique(r.nature_juridique)
  const est_societe = (r.nature_juridique ?? '').startsWith('5')
  const eff = r.tranche_effectif_salarie
  const a_des_salaries = !!eff && eff !== 'NN' && eff !== '00' && eff !== ''
  const est_rge = !!r.complements?.est_rge

  // Finances : on prend l'année la plus récente disponible (souvent absente).
  let ca: number | null = null
  let resultat_net: number | null = null
  let annee_finances: string | null = null
  if (r.finances && Object.keys(r.finances).length) {
    annee_finances = Object.keys(r.finances).sort().reverse()[0]
    const f = r.finances[annee_finances]
    ca = f.ca ?? f.chiffre_d_affaires ?? null
    resultat_net = f.resultat_net ?? null
  }

  // Score /5 indicatif.
  let score: number
  if (!active) {
    score = 1
  } else {
    score = 2 // socle « entreprise active »
    if (anciennete != null) {
      if (anciennete >= 10) score += 2
      else if (anciennete >= 5) score += 1.5
      else if (anciennete >= 3) score += 1
      else if (anciennete >= 1) score += 0.5
    }
    if (est_societe) score += 0.5
    if (a_des_salaries) score += 0.5
    if (est_rge) score += 0.5
    if (resultat_net != null && resultat_net > 0) score += 0.5
  }
  score = Math.max(1, Math.min(5, Math.round(score)))

  const resume = !active
    ? '⚠️ Entreprise cessée / radiée'
    : [
        'Active',
        anciennete != null ? `créée il y a ${anciennete} an${anciennete > 1 ? 's' : ''}` : null,
        forme || null,
        r.categorie_entreprise || null,
        est_rge ? 'RGE' : null,
      ].filter(Boolean).join(' · ')

  return {
    trouve: true, active, raison_sociale: r.nom_raison_sociale || r.nom_complet || '',
    date_creation: r.date_creation ?? null, anciennete_annees: anciennete, forme,
    est_societe, categorie: r.categorie_entreprise ?? null, a_des_salaries, est_rge,
    ca, resultat_net, annee_finances, score, resume,
  }
}
