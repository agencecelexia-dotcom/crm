// Relever une maison et GARDER le résultat : l'extrait de points au stockage
// (pour refaire le calcul sans relire l'IGN), le relevé en base. Réservé aux
// fonctions : tout passe par la clé de service.

import type { Point } from './_geometrie.ts'
import { decompresserLaz } from './_laz.ts'
import { releverDepuisIgn } from './_lecture-releve.ts'
import { reporterAuDossier, rpcService } from './_dossier-serveur.ts'
import { VERSION_RELEVE, type Releve } from './_releve.ts'

export { reporterAuDossier, rpcService }

const URL_BASE = () => Deno.env.get('SUPABASE_URL')!
const CLE_SERVICE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const entetes = () => ({
  'content-type': 'application/json',
  apikey: CLE_SERVICE(),
  authorization: `Bearer ${CLE_SERVICE()}`,
})

async function gzip(octets: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([octets as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'))
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
    body: corps as BodyInit,
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
