// Porter les chiffres d'une maison aux dossiers de métrés de ses chantiers :
// ceux du relevé LiDAR, des photos de façade et du toit lus par Claude.
// Réservé aux fonctions : tout passe par la clé de service. Sans le décodeur
// LAZ : la fonction des photos s'en sert aussi.

import { quantitesDesOuvertures, quantitesDuReleve, quantitesDuToitLu, type QuantiteMesuree } from './_mesures-chantier.ts'
import type { MateriauxGardes } from './_materiaux.ts'
import { clesDuChantier } from './_metrage.ts'
import type { PhotoLue } from './_ouvertures.ts'
import type { Releve } from './_releve.ts'
import { releveUtilisable } from './_releve-retenu.ts'

declare const Deno: { env: { get(nom: string): string | undefined } }

const URL_BASE = () => Deno.env.get('SUPABASE_URL')!
const CLE_SERVICE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const entetes = () => ({
  'content-type': 'application/json',
  apikey: CLE_SERVICE(),
  authorization: `Bearer ${CLE_SERVICE()}`,
})

export async function rpcService(nom: string, params: unknown): Promise<unknown> {
  const res = await fetch(`${URL_BASE()}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: entetes(),
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status} ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}

async function lire<T>(chemin: string): Promise<T> {
  const res = await fetch(`${URL_BASE()}/rest/v1/${chemin}`, { headers: entetes(), signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`dossier_lecture_${res.status}`)
  const donnees = await res.json()
  // Toutes ces lectures sont des listes PostgREST. Une panne ou une réponse
  // incomplète n'est jamais une liste vide permettant d'invalider une mesure.
  if (!Array.isArray(donnees)) throw new Error('dossier_lecture_incomplete')
  return donnees as T
}

const CLES_AUTOMATIQUES = new Set([
  'toit_surface', 'toit_pente', 'toit_pans', 'faitage', 'aretiers', 'noues', 'egouts', 'rives',
  'facades_total', 'hauteur_murs', 'ouvertures', 'ouvertures_surface', 'facade_nette', 'fenetres_toit', 'cheminees',
])

async function ecrire(chemin: string, methode: 'POST' | 'PATCH', corps: unknown, prefer = 'return=minimal') {
  const res = await fetch(`${URL_BASE()}/rest/v1/${chemin}`, {
    method: methode,
    headers: { ...entetes(), prefer },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`dossier_ecriture_${res.status}`)
}

/** Tous les chiffres d'une maison : son relevé, les ouvertures de ses photos lues, les éléments de son toit. */
export async function quantitesDeLaMaisonReleve(cleabs: string, r: Releve): Promise<QuantiteMesuree[]> {
  const c = encodeURIComponent(cleabs)
  const [photos, gardes] = await Promise.all([
    lire<PhotoLue[]>(`facade_photo?cleabs=eq.${c}&lecture=not.is.null&select=id,orientation,source,largeur,hauteur,incidence,lecture,ecartees`),
    lire<{ materiaux: MateriauxGardes | null }[]>(`releve_batiment?cleabs=eq.${c}&select=materiaux`),
  ])
  return [
    ...quantitesDuReleve(r),
    ...quantitesDesOuvertures(r, photos ?? []),
    ...quantitesDuToitLu(gardes?.[0]?.materiaux ?? null),
  ]
}

/**
 * LE DOSSIER SUIT LA MAISON. Les chantiers de cette maison (sûre : reliée à
 * l'adresse par le RNB, ou confirmée par un humain) reçoivent ses chiffres
 * comme valeur MESURÉE — ceux que l'écran affiche : le relevé, les ouvertures
 * lues sur les photos (moins celles que l'artisan a retirées), les éléments du
 * toit. Une valeur confirmée par un humain reste la valeur retenue ; seules
 * les quantités du métier du chantier sont écrites. C'est la pré-mesure : son
 * interrupteur (« auto_pre_metre ») la coupe ici aussi.
 */
export async function reporterAuDossier(cleabs: string, r: Releve): Promise<number> {
  if (!releveUtilisable(r)) return 0
  if ((await rpcService('automatisation_active', { p_cle: 'auto_pre_metre' })) !== true) return 0
  const projets = await lire<{ id: string; metier: string | null; metiers: string[] | null }[]>(
    `projets?batiment_cleabs=eq.${encodeURIComponent(cleabs)}` +
      '&deleted_at=is.null&statut=neq.mort&or=(batiment_source.in.(rnb,artisan,agence),batiment_confirme_at.not.is.null)&select=id,metier,metiers',
  )
  if (!projets?.length) return 0
  const quantites = await quantitesDeLaMaisonReleve(cleabs, r)
  const maintenant = new Date().toISOString()
  let n = 0
  for (const p of projets) {
    const cles = clesDuChantier([...(p.metiers ?? []), p.metier])
    const lignes = quantites
      .filter((q) => cles.has(q.cle))
      .map((q) => ({
        projet_id: p.id,
        cle: q.cle,
        unite: q.unite,
        valeur_mesuree: q.valeur,
        mesure_source: q.source,
        mesure_precision: q.precision ?? null,
        mesure_detail: q.detail ?? null,
        mesuree_le: maintenant,
      }))
    if (lignes.length) {
      // Créer les clés absentes, sans écraser une mesure dessinée en cas de
      // concurrence. Les lignes existantes sont mises à jour sous condition.
      await ecrire('metrage_chantier?on_conflict=projet_id,cle', 'POST', lignes, 'resolution=ignore-duplicates,return=minimal')
      await Promise.all(lignes.map(async (ligne) => {
        const { projet_id, cle, unite, ...mesure } = ligne
        await ecrire(
          `metrage_chantier?projet_id=eq.${encodeURIComponent(projet_id)}&cle=eq.${cle}&unite=eq.${unite}` +
            '&or=(mesure_source.is.null,mesure_source.in.(lidar,photogrammetrie,ia_photo))',
          'PATCH', mesure,
        )
      }))
      n += lignes.length
    }
    // Le recalcul complet a réussi. Les quantités qui ont perdu leur source
    // ne doivent plus survivre comme anciennes mesures. Ne toucher qu'à la
    // branche automatique : la valeur confirmée, sa note et son auteur sont
    // conservés par le trigger metrage_verifier ; dessin/parcelle sont exclus.
    const presentes = new Set(lignes.map((l) => l.cle))
    const absentes = [...cles].filter((cle) => CLES_AUTOMATIQUES.has(cle) && !presentes.has(cle))
    if (absentes.length) {
      await ecrire(
        `metrage_chantier?projet_id=eq.${encodeURIComponent(p.id)}&cle=in.(${absentes.join(',')})` +
          '&mesure_source=in.(lidar,photogrammetrie,ia_photo)',
        'PATCH', { valeur_mesuree: null, mesure_source: null, mesure_precision: null, mesure_detail: null, mesuree_le: null },
      )
    }
  }
  return n
}
