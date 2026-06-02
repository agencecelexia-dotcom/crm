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
