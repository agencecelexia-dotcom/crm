// Relever une maison et GARDER le résultat : l'extrait de points au stockage
// (pour refaire le calcul sans relire l'IGN), le relevé en base. Réservé aux
// fonctions : tout passe par la clé de service.

import type { Point } from './_geometrie.ts'
import { decompresserLaz } from './_laz.ts'
import { releverDepuisIgn } from './_lecture-releve.ts'
import { quantitesDuReleve } from './_mesures-chantier.ts'
import { clesDuChantier } from './_metrage.ts'
import { VERSION_RELEVE, type Releve } from './_releve.ts'
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
    headers: { 'content-type': 'application/json', apikey: CLE_SERVICE(), authorization: `Bearer ${CLE_SERVICE()}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status} ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}

async function gzip(octets: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([octets]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(flux).arrayBuffer())
}

async function deposer(chemin: string, corps: Uint8Array | string, type: string) {
  const res = await fetch(`${URL_BASE()}/storage/v1/object/releves/${chemin}`, {
    method: 'POST',
    headers: {
      apikey: CLE_SERVICE(),
      authorization: `Bearer ${CLE_SERVICE()}`,
      'content-type': type,
      'x-upsert': 'true',
    },
    body: corps,
  })
  if (!res.ok) throw new Error(`stockage_${res.status}`)
}

/**
 * Prendre la main sur le relevé d'une maison. Faux si un autre calcul est en
 * cours, si le relevé est à jour, ou après trois échecs le même jour : la base
 * tranche (`reserver_releve`), pour que deux écrans ouverts ne relisent pas
 * deux fois l'IGN.
 */
export async function reserverReleve(cleabs: string): Promise<boolean> {
  return (await rpcService('reserver_releve', { p_cleabs: cleabs, p_version: VERSION_RELEVE })) === true
}

/** Le relevé gardé d'une maison, s'il est fait et à jour. */
export async function releveGarde(cleabs: string): Promise<Releve | null> {
  const res = await fetch(
    `${URL_BASE()}/rest/v1/releve_batiment?cleabs=eq.${encodeURIComponent(cleabs)}` +
      `&statut=eq.fait&version=gte.${VERSION_RELEVE}&select=releve`,
    { headers: entetes() },
  )
  const [ligne] = res.ok ? ((await res.json()) as { releve: Releve | null }[]) : []
  return ligne?.releve ?? null
}

/**
 * LE DOSSIER SUIT LE RELEVÉ. Les chantiers de cette maison (sûre : reliée à
 * l'adresse par le RNB, ou confirmée par un humain) reçoivent les chiffres du
 * relevé comme valeur MESURÉE — ceux que l'écran affiche. Une valeur
 * confirmée par un humain reste la valeur retenue ; seules les quantités du
 * métier du chantier sont écrites. C'est la pré-mesure : son interrupteur
 * (« auto_pre_metre ») la coupe ici aussi.
 */
export async function reporterAuDossier(cleabs: string, r: Releve): Promise<number> {
  if (!releveUtilisable(r)) return 0
  if ((await rpcService('automatisation_active', { p_cle: 'auto_pre_metre' })) !== true) return 0
  const res = await fetch(
    `${URL_BASE()}/rest/v1/projets?batiment_cleabs=eq.${encodeURIComponent(cleabs)}` +
      '&or=(batiment_source.in.(rnb,artisan,agence),batiment_confirme_at.not.is.null)&select=id,metier,metiers',
    { headers: entetes() },
  )
  if (!res.ok) return 0
  const projets = (await res.json()) as { id: string; metier: string | null; metiers: string[] | null }[]
  const quantites = quantitesDuReleve(r)
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
    else console.error('releve: dossier non mis à jour', p.id, ecrit.status, await ecrit.text())
  }
  return n
}

/**
 * Relever, garder, enregistrer — et, si `reporter`, porter les chiffres aux
 * dossiers de métrés des chantiers de cette maison. Ne lève jamais : un échec
 * s'enregistre comme tel.
 */
export async function releverEtGarder(
  cleabs: string,
  indice: Point | null,
  { reporter = true }: { reporter?: boolean } = {},
): Promise<{ statut: string; releve?: Releve }> {
  const t0 = performance.now()
  const duree = () => Math.round(performance.now() - t0)
  try {
    const issue = await releverDepuisIgn(cleabs, indice, decompresserLaz)
    if (issue.statut !== 'fait') {
      await rpcService('enregistrer_releve', {
        p_cleabs: cleabs,
        p_version: VERSION_RELEVE,
        p_statut: issue.statut,
        p_motif: issue.motif,
        p_duree_ms: duree(),
      })
      return { statut: issue.statut }
    }
    // L'extrait d'abord : un relevé gardé doit pouvoir être refait. Sa perte
    // n'empêche pas d'enregistrer le relevé.
    let extrait = true
    try {
      const dossier = `${cleabs}/v${VERSION_RELEVE}`
      await deposer(`${dossier}/nuage.bin.gz`, await gzip(issue.extrait), 'application/gzip')
      await deposer(`${dossier}/entree.json`, JSON.stringify(issue.entree), 'application/json')
    } catch (e) {
      extrait = false
      console.error('releve: extrait non gardé', cleabs, e)
    }
    const r = issue.releve
    await rpcService('enregistrer_releve', {
      p_cleabs: cleabs,
      p_version: VERSION_RELEVE,
      p_statut: 'fait',
      p_motif: r.motif,
      p_confiance: r.confiance,
      p_releve: r,
      p_toit_vrai: r.surfaces.toitVrai,
      p_toit_plan: r.surfaces.toitPlan,
      p_recalage: Math.round(Math.hypot(r.recalage.dx, r.recalage.dy) * 100) / 100,
      p_vol: r.vol,
      p_octets: issue.octets,
      p_duree_ms: duree(),
      p_extrait: extrait,
    })
    if (reporter) {
      const n = await reporterAuDossier(cleabs, r).catch((e) => {
        console.error('releve: report au dossier', cleabs, e)
        return 0
      })
      if (n) console.log('releve: dossier', cleabs, n, 'quantités')
    }
    return { statut: 'fait', releve: r }
  } catch (e) {
    console.error('releve: échec', cleabs, e)
    await rpcService('enregistrer_releve', {
      p_cleabs: cleabs,
      p_version: VERSION_RELEVE,
      p_statut: 'echec',
      p_motif: String(e instanceof Error ? e.message : e).slice(0, 200),
      p_duree_ms: duree(),
    }).catch(() => undefined)
    return { statut: 'echec' }
  }
}
