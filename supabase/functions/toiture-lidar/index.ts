// Edge Function : la pente d'un toit, mesurée et non plus devinée.
//
// CE QU'ELLE REMPLACE
//
// Jusqu'ici la pente venait des altitudes de la BD TOPO : faîtage moins
// gouttière, rapporté à la demi-largeur du bâtiment. La précision altimétrique
// d'un mètre y laissait une marge de ±27 à ±61 POINTS — un chiffre indéfendable,
// que l'audit a justement traité de bruit habillé.
//
// L'IGN diffuse gratuitement, sans clé, le modèle numérique de surface issu du
// LiDAR HD : une grille d'altitudes à CINQUANTE CENTIMÈTRES. La pente n'y est
// plus déduite d'une hypothèse de toit à deux pans, elle est LUE dans la donnée,
// pixel par pixel. Écart interquartile mesuré sur des maisons réelles : ±2 à
// ±10 points, et les versants ressortent par paires opposées — ce que doit
// donner un toit à deux pans.
//
// Le calcul lui-même vit dans `../_calcul-toit.ts`, partagé avec les tests et
// le banc de justesse ; ici, l'accès (jeton de l'artisan) et le cache.

import { mesurerToit } from '../_calcul-toit.ts'

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
    const { token, contour, cleabs, rafraichir } = (await req.json()) ?? {}
    if (typeof token !== 'string' || !Array.isArray(contour) || contour.length < 3) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    if (await rpc('token_artisan_valide', { p_token: token }) !== true) {
      return json({ ok: false, error: 'token_invalide' }, 403, CORS)
    }

    // Un toit ne bouge pas. Chaque mesure évitée épargne deux images à l'IGN,
    // cinq secondes à l'artisan, et protège les appels suivants de l'étranglement.
    const cle = typeof cleabs === 'string' && cleabs.trim() ? cleabs.trim() : null
    if (cle && !rafraichir) {
      const c = await rpc('toiture_by_token', { p_token: token, p_cleabs: cle })
      const v = c as { trouvee?: boolean; couvert?: boolean; motif?: string | null; version?: number }
      // Le cache garde `motif` mais pas `fiable` : c'est la même chose dite
      // autrement, et une colonne de moins à tenir cohérente.
      // Une mesure antérieure aux murs (version 1) est refaite : la servir
      // laisserait l'onglet Façades sur la hauteur de la BD TOPO. De même une
      // mesure antérieure aux pans (version 2) : le toit se lit pan par pan.
      if (v?.trouvee && (v.version ?? 1) >= 3) {
        return json({ ok: true, cache: true, ...(c as object), fiable: !!v.couvert && !v.motif }, 200, CORS)
      }
    }

    const r = await mesurerToit(contour as [number, number][])
    if (cle) {
      await rpc(
        'enregistrer_toiture',
        r.couvert
          ? {
              p_cleabs: cle, p_couvert: true, p_motif: r.motif,
              p_pente: r.pente, p_incertitude: r.incertitude,
              p_pixels: r.pixels, p_versants: r.versants, p_source: r.source,
              p_murs: r.murs, p_hauteur_gouttiere: r.hauteur_gouttiere,
              p_hauteur_faitage: r.hauteur_faitage, p_version: 3,
              p_facteur: r.facteur, p_part_plate: r.part_plate, p_pans: r.pans,
            }
          : {
              p_cleabs: cle, p_couvert: false, p_motif: r.motif,
              p_pente: null, p_incertitude: null, p_pixels: null, p_versants: [], p_source: null,
            },
      ).catch(() => {})
    }
    return json(r, 200, CORS)
  } catch (e) {
    if (e instanceof Error && e.message === 'batiment_trop_grand') {
      return json({ ok: false, error: 'batiment_trop_grand' }, 400, CORS)
    }
    console.error('toiture-lidar', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
