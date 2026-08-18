import { supabase } from '@/lib/supabase/client'
import type { LeadExtrait } from './checklist'

/**
 * Vérifications externes : adresse réelle et doublon.
 *
 * Ces deux contrôles ont chacun attrapé une erreur lors des saisies manuelles
 * de la semaine : « rue de la Saint-Marc » à Fleury-les-Aubrais n'existe pas
 * (la BAN proposait « rue de la Barrière Saint-Marc »), et une fiche Maurice
 * Dupont a été créée en double faute d'avoir cherché le numéro d'abord.
 *
 * On utilise la Base Adresse Nationale plutôt que Nominatim : elle est
 * officielle, sans quota bloquant, et renvoie un score de confiance exploitable.
 */

export interface AdresseVerifiee {
  /** Libellé officiel complet. */
  label: string
  adresse: string
  code_postal: string
  ville: string
  latitude: number
  longitude: number
  score: number
  /** Vrai si la BAN a trouvé le numéro exact, pas seulement la rue. */
  numeroExact: boolean
}

export async function verifierAdresse(l: LeadExtrait): Promise<AdresseVerifiee[]> {
  const morceaux = [l.client_adresse, l.client_ville].filter(Boolean).join(' ').trim()
  if (morceaux.length < 4) return []

  const url = new URL('https://api-adresse.data.gouv.fr/search/')
  url.searchParams.set('q', morceaux)
  url.searchParams.set('limit', '3')
  const cp = (l.client_code_postal ?? '').replace(/\D/g, '')
  if (cp.length === 5) url.searchParams.set('postcode', cp)

  try {
    const r = await fetch(url)
    if (!r.ok) return []
    const data = (await r.json()) as {
      features: {
        properties: {
          label: string
          name: string
          postcode: string
          city: string
          score: number
          type: string
        }
        geometry: { coordinates: [number, number] }
      }[]
    }
    return data.features.map((f) => ({
      label: f.properties.label,
      adresse: f.properties.name,
      code_postal: f.properties.postcode,
      ville: f.properties.city,
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
      score: f.properties.score,
      numeroExact: f.properties.type === 'housenumber',
    }))
  } catch {
    // Réseau indisponible : on n'empêche pas la saisie pour autant.
    return []
  }
}

export interface Doublon {
  id: string
  client_nom: string
  client_ville: string | null
  statut: string
  created_at: string
}

/**
 * Recherche d'un projet existant sur le numéro de téléphone.
 *
 * Le numéro est le seul identifiant fiable : les noms sont orthographiés de
 * dix façons et un même client peut rappeler des semaines plus tard. On
 * compare sur les chiffres uniquement, les formats de saisie variant
 * (« 06 12 34 56 78 » et « 0612345678 » coexistent en base).
 */
export async function chercherDoublon(telephone: string): Promise<Doublon[]> {
  const tel = telephone.replace(/\D/g, '')
  if (tel.length < 9) return []
  const fin = tel.slice(-9)

  const { data, error } = await supabase
    .from('projets')
    .select('id, client_nom, client_ville, statut, created_at, client_telephone')
    .is('deleted_at', null)
    .limit(400)

  if (error || !data) return []

  return data
    .filter((p) => (p.client_telephone ?? '').replace(/\D/g, '').endsWith(fin))
    .map(({ id, client_nom, client_ville, statut, created_at }) => ({
      id,
      client_nom,
      client_ville,
      statut,
      created_at,
    }))
}
