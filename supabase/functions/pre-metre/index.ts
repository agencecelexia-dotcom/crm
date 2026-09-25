// Edge Function : la pré-mesure des chantiers.
//
// L'artisan ouvre sa fiche et trouve ses métrés prêts : la maison désignée,
// le toit mesuré au LiDAR, les façades, le terrain — et, au dossier, ce que le
// client avait dit, confronté à la mesure. Rien n'attend son premier clic.
//
// QUI L'APPELLE
//
// La tâche planifiée `pre_metre_tick`, toutes les dix minutes, avec une clé
// partagée (coffre de la base d'un côté, secrets de la fonction de l'autre).
// Personne d'autre : elle écrit en base avec la clé de service.
//
// CE QU'ELLE S'INTERDIT
//
// - Tourner quand l'interrupteur « auto_pre_metre » est coupé : elle le relit
//   elle-même, même si la tâche planifiée l'a déjà lu.
// - Mesurer une maison INCERTAINE : des chiffres justes sur la maison d'un
//   autre sont pires que pas de chiffres. Seules les maisons reliées à
//   l'adresse par le registre national, ou confirmées par un humain.
// - Toucher à une décision humaine : une valeur confirmée au dossier reste.
// - Brusquer l'IGN, qui étrangle par adresse : six chantiers au plus par
//   passage, quatre secondes entre deux.

import { identifierMaison, maisonConfirmee, type Dossier } from '../_batiment.ts'
import { mesurerToit, type MurMesure, type Pan, type ResultatToit } from '../_calcul-toit.ts'
import { centre, type Point } from '../_geometrie.ts'
import { quantitesDeLaMaison } from '../_mesures-chantier.ts'
import { parcelleSous } from '../_parcelle.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

const MAX_PAR_PASSAGE = 6
const ESPACEMENT_MS = 4000

const URL_BASE = () => Deno.env.get('SUPABASE_URL')!
const CLE_SERVICE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const entetes = () => ({
  'content-type': 'application/json',
  apikey: CLE_SERVICE(),
  authorization: `Bearer ${CLE_SERVICE()}`,
})

async function rpc(nom: string, params: unknown) {
  const res = await fetch(`${URL_BASE()}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: entetes(),
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status}`)
  return await res.json()
}

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })

interface ProjetAMesurer {
  id: string
  client_adresse: string | null
  client_code_postal: string | null
  client_ville: string | null
  latitude: number | null
  longitude: number | null
  batiment_cleabs: string | null
  batiment_source: string | null
  batiment_confirme_at: string | null
  batiment_lon: number | null
  batiment_lat: number | null
}

/** Le toit : le cache de l'outil d'abord, sinon une mesure — gardée pour la suite. */
async function toitDe(cleabs: string, contour: Point[]): Promise<ResultatToit> {
  const res = await fetch(
    `${URL_BASE()}/rest/v1/toiture_mesuree?cleabs=eq.${encodeURIComponent(cleabs)}&version=gte.3` +
      '&select=couvert,motif,pente_pct,incertitude,pixels,versants,source,murs,hauteur_gouttiere,hauteur_faitage,facteur,part_plate,pans,mesure_le',
    { headers: entetes() },
  )
  const [c] = res.ok ? ((await res.json()) as Record<string, unknown>[]) : []
  if (c) {
    if (!c.couvert) return { ok: true, couvert: false, motif: (c.motif as 'hors_couverture') ?? 'trop_peu_de_toit' }
    const n = (v: unknown) => (v == null ? null : Number(v))
    return {
      ok: true,
      couvert: true,
      fiable: !c.motif,
      motif: (c.motif as 'toit_sans_pan_dominant' | null) ?? null,
      pente: Number(c.pente_pct),
      incertitude: Number(c.incertitude),
      pixels: Number(c.pixels),
      versants: (c.versants as { orientation: string; part: number }[]) ?? [],
      source: String(c.source),
      mesure_le: String(c.mesure_le),
      murs: (c.murs as MurMesure[] | null) ?? null,
      hauteur_gouttiere: n(c.hauteur_gouttiere),
      hauteur_faitage: n(c.hauteur_faitage),
      facteur: Number(c.facteur),
      part_plate: Number(c.part_plate),
      pans: (c.pans as Pan[]) ?? [],
    }
  }
  const r = await mesurerToit(contour)
  await rpc(
    'enregistrer_toiture',
    r.couvert
      ? {
          p_cleabs: cleabs, p_couvert: true, p_motif: r.motif,
          p_pente: r.pente, p_incertitude: r.incertitude,
          p_pixels: r.pixels, p_versants: r.versants, p_source: r.source,
          p_murs: r.murs, p_hauteur_gouttiere: r.hauteur_gouttiere,
          p_hauteur_faitage: r.hauteur_faitage, p_version: 3,
          p_facteur: r.facteur, p_part_plate: r.part_plate, p_pans: r.pans,
        }
      : {
          p_cleabs: cleabs, p_couvert: false, p_motif: r.motif,
          p_pente: null, p_incertitude: null, p_pixels: null, p_versants: [], p_source: null,
        },
  ).catch(() => undefined)
  return r
}

/** Un chantier : sa maison, ses mesures, et le dossier de métrés rempli. */
async function premesurer(p: ProjetAMesurer): Promise<string> {
  const dossier: Dossier = {
    adresse: p.client_adresse,
    codePostal: p.client_code_postal,
    ville: p.client_ville,
    point: p.longitude != null && p.latitude != null ? [Number(p.longitude), Number(p.latitude)] : null,
  }

  // 1. La maison — confirmée par un humain, sinon reliée à l'adresse par le RNB.
  let maison: { cleabs: string; contour: Point[] } | null = null
  const humaine = p.batiment_confirme_at || p.batiment_source === 'artisan' || p.batiment_source === 'agence'
  if (p.batiment_cleabs && humaine) {
    const point: Point | null =
      p.batiment_lon != null && p.batiment_lat != null ? [Number(p.batiment_lon), Number(p.batiment_lat)] : null
    const r = await maisonConfirmee(dossier, p.batiment_cleabs, point)
    if (r?.principal) maison = { cleabs: r.principal.cleabs, contour: r.principal.contour as Point[] }
  } else {
    const { reponse, aGarder } = await identifierMaison(dossier)
    await rpc('enregistrer_batiment_projet', {
      p_projet_id: p.id,
      p_cleabs: aGarder.cleabs,
      p_source: aGarder.source,
      p_adresse: aGarder.adresse,
      p_score: aGarder.score,
      p_lon: aGarder.point?.[0] ?? null,
      p_lat: aGarder.point?.[1] ?? null,
    }).catch(() => undefined)
    if (reponse.confiance !== 'officielle' || !reponse.principal) return `maison ${reponse.confiance}`
    maison = { cleabs: reponse.principal.cleabs, contour: reponse.principal.contour as Point[] }
  }
  if (!maison) return 'maison introuvable'

  // 2. Le toit et les murs.
  await pause(ESPACEMENT_MS)
  const toit = await toitDe(maison.cleabs, maison.contour)
  const quantites = quantitesDeLaMaison(maison.contour, toit)

  // 3. Le terrain : la parcelle sous la maison.
  const c = centre(maison.contour)
  if (c) {
    const parcelle = await parcelleSous(c).catch(() => null)
    if (parcelle) {
      quantites.push({
        cle: 'parcelle_surface',
        unite: 'm2',
        valeur: Math.round(parcelle.surface),
        source: 'parcelle',
        detail: { parcelle: parcelle.id, perimetre_m: Math.round(parcelle.perimetre * 10) / 10 },
      })
    }
  }
  if (!quantites.length) return 'rien de mesurable'

  // 4. Le dossier de métrés : la VALEUR MESURÉE seulement. Le statut se déduit
  //    en base (déclaré contre mesuré), et une confirmation humaine reste.
  const res = await fetch(`${URL_BASE()}/rest/v1/metrage_chantier?on_conflict=projet_id,cle`, {
    method: 'POST',
    headers: { ...entetes(), prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(
      quantites.map((q) => ({
        projet_id: p.id,
        cle: q.cle,
        unite: q.unite,
        valeur_mesuree: q.valeur,
        mesure_source: q.source,
        mesure_detail: q.detail ?? null,
        mesuree_le: new Date().toISOString(),
      })),
    ),
  })
  if (!res.ok) throw new Error(`metrage ${res.status} ${await res.text()}`)
  return `${quantites.length} quantités`
}

async function traiter(projets: ProjetAMesurer[]) {
  for (const p of projets) {
    const bilan = await premesurer(p).catch((e) => `échec : ${e instanceof Error ? e.message : e}`)
    console.log('pre-metre', p.id, bilan)
    // Réussie ou non, la tentative est notée : un chantier sans maison sûre
    // ne revient qu'une fois par jour.
    await rpc('marquer_premesure', { p_projet_id: p.id }).catch(() => undefined)
    await pause(ESPACEMENT_MS)
  }
}

Deno.serve(async (req) => {
  const cle = Deno.env.get('PRE_METRE_CLE')
  if (!cle || req.headers.get('x-cle-pre-metre') !== cle) return json({ ok: false, error: 'interdit' }, 403)

  // L'interrupteur, relu ici même : couper l'automatisation la coupe vraiment.
  if ((await rpc('automatisation_active', { p_cle: 'auto_pre_metre' })) !== true) {
    return json({ ok: true, actif: false })
  }
  const projets = (await rpc('projets_a_premesurer', { p_limite: MAX_PAR_PASSAGE })) as ProjetAMesurer[]
  // Répondre tout de suite : la tâche planifiée n'attend pas la fin des mesures.
  EdgeRuntime.waitUntil(traiter(projets))
  return json({ ok: true, actif: true, chantiers: projets.length }, 202)
})
