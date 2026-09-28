// Edge Function : le relevé d'une maison dans le nuage de points LiDAR HD.
//
// VERSION D'ESSAI (lot 0 du plan « mesurer dans les points ») : elle lit les
// points classés autour de la maison et rend ce que cela coûte — octets,
// requêtes, temps de décodage — pour décider si le relevé tient dans les
// limites des fonctions (2 s de calcul, 256 Mo). Les lots suivants y
// ajouteront le recalage, les pans, les murs et le cache.

import { CLASSES_UTILES, lireEntete, lirePoints, noeudsDansZone, type Decompresseur, type Nuage, type Zone } from '../_copc.ts'
import { versLambert93 } from '../_calcul-toit.ts'
import { dallesPour, lecteurHttp, type Journal } from '../_lidar-hd.ts'
import { decompresserLaz } from '../_laz.ts'

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]
function cors(origin: string | null) {
  const ok = origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (b: unknown, s: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...h, 'content-type': 'application/json' } })

async function rpc(nom: string, params: unknown) {
  const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cle, authorization: `Bearer ${cle}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status}`)
  return await res.json()
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { token, contour, marge } = ((await req.json().catch(() => ({}))) ?? {}) as {
      token?: string
      contour?: [number, number][]
      marge?: number
    }
    if (typeof token !== 'string' || !Array.isArray(contour) || contour.length < 3) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    if ((await rpc('token_artisan_valide', { p_token: token })) !== true) {
      return json({ ok: false, error: 'token_invalide' }, 403, CORS)
    }

    const t0 = performance.now()
    const poly = contour.map(([lon, lat]) => versLambert93(lon, lat))
    const m = typeof marge === 'number' && marge >= 0 && marge <= 20 ? marge : 8
    const zone: Zone = {
      minX: Math.min(...poly.map((p) => p[0])) - m,
      minY: Math.min(...poly.map((p) => p[1])) - m,
      maxX: Math.max(...poly.map((p) => p[0])) + m,
      maxY: Math.max(...poly.map((p) => p[1])) + m,
    }
    const dalles = await dallesPour(zone)
    if (!dalles.length) return json({ ok: true, couvert: false, motif: 'hors_couverture' }, 200, CORS)

    const compteur: Journal = { requetes: 0, octets: 0, detail: [] }
    let tDecodage = 0
    const decompresser: Decompresseur = async (...a) => {
      const t = performance.now()
      const r = await decompresserLaz(...a)
      tDecodage += performance.now() - t
      return r
    }
    const nuages: Nuage[] = []
    let noeuds = 0
    let pointsLus = 0
    const tDalles = performance.now()
    for (const d of dalles) {
      const lire = lecteurHttp(d.url, compteur)
      const e = await lireEntete(lire)
      const n = await noeudsDansZone(lire, e, zone)
      noeuds += n.length
      pointsLus += n.reduce((s, x) => s + x.nbPoints, 0)
      nuages.push((await lirePoints(lire, e, n, decompresser, zone, CLASSES_UTILES)).nuage)
    }
    const parClasse: Record<number, number> = {}
    let gardes = 0
    for (const nu of nuages) {
      gardes += nu.nb
      for (let i = 0; i < nu.nb; i++) parClasse[nu.classe[i]] = (parClasse[nu.classe[i]] ?? 0) + 1
    }
    const surface = (zone.maxX - zone.minX) * (zone.maxY - zone.minY)
    return json(
      {
        ok: true,
        couvert: true,
        dalles: dalles.map((d) => ({ vol: d.vol, fichier: d.url.split('/').pop() })),
        noeuds,
        points_lus: pointsLus,
        points_gardes: gardes,
        densite: Math.round((gardes / surface) * 10) / 10,
        par_classe: parClasse,
        octets: compteur.octets,
        requetes: compteur.requetes,
        journal: compteur.detail,
        ms: {
          metadonnees: Math.round(tDalles - t0),
          lecture_et_decodage: Math.round(performance.now() - tDalles),
          decodage: Math.round(tDecodage),
          total: Math.round(performance.now() - t0),
        },
      },
      200,
      CORS,
    )
  } catch (e) {
    console.error('releve-lidar', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
