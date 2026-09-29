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

async function lire<T>(chemin: string): Promise<T | null> {
  const res = await fetch(`${URL_BASE()}/rest/v1/${chemin}`, { headers: entetes() })
  return res.ok ? ((await res.json()) as T) : null
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
      '&or=(batiment_source.in.(rnb,artisan,agence),batiment_confirme_at.not.is.null)&select=id,metier,metiers',
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
    if (!lignes.length) continue
    const ecrit = await fetch(`${URL_BASE()}/rest/v1/metrage_chantier?on_conflict=projet_id,cle`, {
      method: 'POST',
      headers: { ...entetes(), prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(lignes),
    })
    if (ecrit.ok) n += lignes.length
    else console.error('dossier: non mis à jour', p.id, ecrit.status, await ecrit.text())
  }
  return n
}
