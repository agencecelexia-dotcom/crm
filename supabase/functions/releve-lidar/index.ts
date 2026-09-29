// Edge Function : le relevé d'une maison dans le nuage de points LiDAR HD.
//
// Le toit pan par pan, le débord mesuré côté par côté, le contour recalé sur
// le toit, les façades avec leur silhouette : tout vient des points classés
// de l'IGN (`_releve.ts`). Ici, l'accès (jeton de l'artisan) et le cache.
//
// POURQUOI EN ARRIÈRE-PLAN
//
// Le serveur de l'IGN met 20 à 75 secondes à servir les morceaux d'une maison.
// La fonction répond donc aussitôt « en cours », mène le relevé après sa
// réponse (`EdgeRuntime.waitUntil`), et l'écran redemande toutes les quelques
// secondes. Le relevé est gardé par bâtiment : deux chantiers sur la même
// maison, ou la pré-mesure puis l'artisan, ne relisent pas l'IGN.
//
// Le contour vient de la BD TOPO, relu ici même : jamais du navigateur, car
// le relevé gardé sert à tous.

import { JETON_AGENCE, jetonDe, membreActif } from '../_membre.ts'
import { reserverReleve, releverEtGarder, rpcService } from '../_releve-serveur.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

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

/** Le relevé d'une maison, lu pour un membre de l'agence : les mêmes champs que `releve_by_token`. */
async function releveGardeAgence(cleabs: string) {
  const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/rest/v1/releve_batiment?cleabs=eq.${cleabs}` +
      '&select=id,statut,version,motif,confiance,releve,essais,demande_le,fait_le',
    { headers: { apikey: cle, authorization: `Bearer ${cle}` } },
  )
  if (!res.ok) throw new Error(`releve ${res.status}`)
  const [v] = (await res.json()) as ({ statut: string; releve: unknown } & Record<string, unknown>)[]
  return v ? { trouve: true, ...v, releve: v.statut === 'fait' ? v.releve : null } : { trouve: false }
}

const estPoint = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
  p[0] > -6 && p[0] < 10 && p[1] > 41 && p[1] < 52

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { token, cleabs, point } = ((await req.json().catch(() => ({}))) ?? {}) as {
      token?: string
      cleabs?: string
      point?: unknown
    }
    if (typeof token !== 'string' || typeof cleabs !== 'string' || !/^BATIMENT\d{16}$/.test(cleabs)) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    // L'artisan par son jeton ; l'agence par la session d'un membre actif.
    const agence = token === JETON_AGENCE
    if (agence && !(await membreActif(jetonDe(req)))) return json({ ok: false, error: 'token_invalide' }, 403, CORS)
    const lire = () =>
      (agence ? releveGardeAgence(cleabs) : rpcService('releve_by_token', { p_token: token, p_cleabs: cleabs })) as Promise<{
        trouve?: boolean
        error?: string
      }>
    const actuel = await lire()
    if (actuel.error === 'token_invalide') return json({ ok: false, error: 'token_invalide' }, 403, CORS)

    // La base dit s'il faut relever : absent, périmé, ou échec ancien.
    if (await reserverReleve(cleabs)) {
      // Le relevé fait, les dossiers de métrés des chantiers de cette maison
      // en reçoivent les chiffres (sous l'interrupteur de la pré-mesure).
      EdgeRuntime.waitUntil(releverEtGarder(cleabs, estPoint(point) ? point : null))
      return json({ ok: true, trouve: true, statut: 'en_cours' }, 200, CORS)
    }
    return json({ ok: true, ...(await lire()) }, 200, CORS)
  } catch (e) {
    console.error('releve-lidar', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
