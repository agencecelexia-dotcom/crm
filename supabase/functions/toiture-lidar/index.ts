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

import { mesurerToit, VERSION_TOITURE } from '../_calcul-toit.ts'
import { parCleabs } from '../_batiment.ts'
import { corsMetre } from '../_cors-metre.ts'

declare const Deno: { env: { get(nom: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

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
  const CORS = corsMetre(req.headers.get('origin'), Deno.env.get('SITE_URL'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'methode_invalide' }, 405, CORS)

  try {
    const { token, contour, cleabs, rafraichir } = (await req.json()) ?? {}
    if (typeof token !== 'string' || !Array.isArray(contour) || contour.length < 3 || contour.length > 10_000 || contour.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v)) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 90)) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    const cle = typeof cleabs === 'string' && cleabs.trim() ? cleabs.trim() : null
    if (cle && !/^BATIMENT\d{16}$/.test(cle)) return json({ ok: false, error: 'cleabs_invalide' }, 400, CORS)
    if (await rpc('token_artisan_valide', { p_token: token }) !== true) {
      return json({ ok: false, error: 'token_invalide' }, 403, CORS)
    }

    // Un toit ne bouge pas. Chaque mesure évitée épargne deux images à l'IGN,
    // cinq secondes à l'artisan, et protège les appels suivants de l'étranglement.
    if (cle && !rafraichir) {
      const c = await rpc('toiture_by_token', { p_token: token, p_cleabs: cle })
      const v = c as { trouvee?: boolean; couvert?: boolean; motif?: string | null; version?: number }
      // Le cache garde `motif` mais pas `fiable` : c'est la même chose dite
      // autrement, et une colonne de moins à tenir cohérente.
      // Les anciennes mesures pouvaient provenir d'un contour envoyé par
      // le navigateur, sans lien vérifié avec l'identifiant partagé.
      if (v?.trouvee && (v.version ?? 1) >= VERSION_TOITURE) {
        return json({ ok: true, cache: true, ...(c as object), fiable: !!v.couvert && !v.motif }, 200, CORS)
      }
    }

    let contourMesure = contour as [number, number][]
    if (cle) {
      // Le contour client n'est qu'un indice spatial pour accélérer la
      // recherche. Seule la géométrie IGN du bon cleabs peut entrer au cache.
      const point: [number, number] = [contourMesure.reduce((s, p) => s + p[0], 0) / contourMesure.length, contourMesure.reduce((s, p) => s + p[1], 0) / contourMesure.length]
      const batiment = (await parCleabs([cle], [point])).find((b) => b.cleabs === cle)
      if (!batiment) return json({ ok: false, error: 'batiment_introuvable' }, 404, CORS)
      contourMesure = batiment.contour
    }
    const r = await mesurerToit(contourMesure)
    if (cle) {
      await rpc(
        'enregistrer_toiture',
        r.couvert
          ? {
              p_cleabs: cle, p_couvert: true, p_motif: r.motif,
              p_pente: r.pente, p_incertitude: r.incertitude,
              p_pixels: r.pixels, p_versants: r.versants, p_source: r.source,
              p_murs: r.murs, p_hauteur_gouttiere: r.hauteur_gouttiere,
              p_hauteur_faitage: r.hauteur_faitage, p_version: VERSION_TOITURE,
              p_facteur: r.facteur, p_part_plate: r.part_plate, p_pans: r.pans,
            }
          : {
              p_cleabs: cle, p_couvert: false, p_motif: r.motif,
              p_version: VERSION_TOITURE,
              p_pente: null, p_incertitude: null, p_pixels: null, p_versants: [], p_source: null,
            },
      ).catch(() => {})
    }
    return json(r, 200, CORS)
  } catch (e) {
    if (e instanceof Error && ['batiment_trop_grand', 'contour_invalide'].includes(e.message)) {
      return json({ ok: false, error: e.message }, 400, CORS)
    }
    console.error('toiture-lidar', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
