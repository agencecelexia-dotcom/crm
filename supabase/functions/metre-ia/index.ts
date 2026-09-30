// Edge Function : « Mesurer avec l'IA ». Lit une maison — LiDAR, photo aérienne,
// carte des hauteurs, photos de rue — et garde la scène que l'IA en comprend
// (`_metre-ia-serveur.ts`). Ici, l'accès et le suivi.
//
// POURQUOI EN ARRIÈRE-PLAN
//
// La lecture prend une à trois minutes (le relevé LiDAR à lui seul, 20 à 75 s).
// La fonction répond aussitôt « en cours », lit après sa réponse
// (`EdgeRuntime.waitUntil`), et l'écran redemande toutes les quelques secondes.
//
// Actions : `etat` (lire ce qui est gardé, sans rien lancer) et `lire` (lancer,
// à la demande de l'artisan : la lecture est payante à l'usage).

import { JETON_AGENCE, jetonDe, membreActif } from '../_membre.ts'
import { lectureGardee, lecturesDuJour, lireLaMaison, reserver, VERSION_METRE_IA } from '../_metre-ia-serveur.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

/** Combien de lectures par personne et par jour : chacune coûte quelques dizaines de centimes. */
const LECTURES_PAR_JOUR = 8

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

const estPoint = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) && p[0] > -6 && p[0] < 10 && p[1] > 41 && p[1] < 52

/** Qui appelle : un artisan (son jeton) ou un membre de l'agence (sa session). Rend un identifiant, ou null. */
async function acteurDe(req: Request, jeton: string): Promise<string | null> {
  // Le banc d'essai (`scripts/banc-ia.ts`) : la clé de service, jamais celle du navigateur.
  if (jeton === 'banc') return req.headers.get('authorization') === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` ? 'banc' : null
  if (jeton === JETON_AGENCE) return (await membreActif(jetonDe(req)))?.user_id ?? null
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/artisans?token=eq.${encodeURIComponent(jeton)}&ecarte_at=is.null&select=id`, {
    headers: { apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}` },
  })
  const [a] = r.ok ? ((await r.json()) as { id: string }[]) : []
  return a?.id ?? null
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { token?: string; cleabs?: string; action?: string; point?: unknown; relire?: boolean }
    if (typeof b.token !== 'string' || typeof b.cleabs !== 'string' || !/^BATIMENT\d{16}$/.test(b.cleabs)) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    const acteur = await acteurDe(req, b.token)
    if (!acteur) return json({ ok: false, error: 'token_invalide' }, 403, CORS)

    const gardee = await lectureGardee(b.cleabs)
    const etat = (l: typeof gardee) => (l ? { trouve: true, ...l, scene: l.statut === 'fait' ? l.scene : null } : { trouve: false })

    if (b.action !== 'lire') return json({ ok: true, ...etat(gardee) }, 200, CORS)

    // Une lecture déjà faite, à jour : on la rend. La refaire est un choix (`action: 'relire'`) — non offert ici.
    // Le banc, lui, relit à volonté (`relire`) : il mesure la lecture, pas l'usage.
    const relire = b.relire === true && acteur === 'banc'
    if (!relire && gardee?.statut === 'fait' && gardee.version >= VERSION_METRE_IA) return json({ ok: true, ...etat(gardee) }, 200, CORS)
    if (gardee?.statut === 'en_cours' && Date.now() - new Date(gardee.demande_le).getTime() < 8 * 60e3) return json({ ok: true, ...etat(gardee) }, 200, CORS)
    if (acteur !== 'banc' && (await lecturesDuJour(acteur)) >= LECTURES_PAR_JOUR) return json({ ok: false, error: 'quota_atteint' }, 200, CORS)
    if (!(await reserver(b.cleabs, acteur))) return json({ ok: true, ...etat(await lectureGardee(b.cleabs)) }, 200, CORS)

    EdgeRuntime.waitUntil(
      lireLaMaison(b.cleabs, estPoint(b.point) ? b.point : null, { token: b.token, autorisation: req.headers.get('authorization'), acteur }),
    )
    return json({ ok: true, trouve: true, statut: 'en_cours', etape: 'Démarrage', etapes: [] }, 200, CORS)
  } catch (e) {
    console.error('metre-ia', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
