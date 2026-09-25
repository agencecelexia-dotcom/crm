// Edge Function : quelle est LA maison de ce chantier ?
//
// CE QU'ELLE REMPLACE
//
// La maison était choisie à chaque ouverture de la carte : le bâtiment dont le
// CENTRE est le plus proche du point d'adresse. Or ce point tombe souvent sur
// la chaussée — à Sathonay, dans aucune parcelle —, et la maison d'en face
// peut être plus proche. Rien ne vérifiait non plus le score de l'adresse :
// sur trente chantiers réels, treize adresses sur vingt-quatre passent sous
// 0,8, et « Sathonay-Village » était retrouvé à Sathonay-Camp sans un mot.
//
// LA RÈGLE
//
// 1. L'adresse est cherchée dans la Base Adresse Nationale, filtrée par code
//    postal quand on le connaît ; on garde son score et la commune retrouvée.
// 2. Le Référentiel national des bâtiments (RNB) relie OFFICIELLEMENT une
//    adresse à son bâtiment : 23 adresses réelles sur 24 le sont, avec
//    l'identifiant BD TOPO. C'est lui qui désigne la maison.
// 3. À défaut, le bâtiment qui CONTIENT le point d'adresse ; sinon le plus
//    proche à moins de vingt mètres — et l'écran demande confirmation.
// 4. Une maison confirmée par un humain l'emporte sur tout recalcul.
//
// Tout passe par ici plutôt que par le navigateur : la BAN, le RNB et le WFS
// de l'IGN n'ont pas à figurer dans la politique de sécurité du site, et la
// pré-mesure des chantiers (sans écran) a besoin du même calcul. Ce calcul vit
// dans `../_batiment.ts`, partagé avec le banc de justesse ; ici, l'accès (le
// jeton de l'artisan) et la mémoire du projet.

import {
  identifierMaison,
  maisonConfirmee,
  maisonDeLAdresseChoisie,
  type Dossier,
} from '../_batiment.ts'

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

const CLE_SERVICE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function rpc(nom: string, params: unknown) {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CLE_SERVICE(), authorization: `Bearer ${CLE_SERVICE()}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status}`)
  return await res.json()
}

/** L'adresse choisie par l'artisan, si elle est bien formée : un identifiant BAN et un point. */
function lireAdresseChoisie(a: { id?: unknown; label?: unknown; point?: unknown } | undefined) {
  if (!a || typeof a.id !== 'string' || !/^[\w-]{5,64}$/.test(a.id) || !Array.isArray(a.point)) return null
  const [lon, lat] = a.point.map(Number)
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null
  return { id: a.id, label: typeof a.label === 'string' ? a.label.slice(0, 200) : null, point: [lon, lat] as [number, number] }
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const corps = (await req.json().catch(() => ({}))) as {
      token?: string
      affectation_token?: string
      rafraichir?: boolean
      /** Une adresse que l'artisan a cherchée lui-même, à la place de celle du dossier. */
      adresse?: { id?: unknown; label?: unknown; point?: unknown }
    }
    if (typeof corps.token !== 'string' || typeof corps.affectation_token !== 'string') {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }

    // Le contexte vérifie le jeton de l'artisan, son affectation, et ne donne
    // l'adresse qu'une fois le contrat signé.
    const ctx = (await rpc('metre_contexte_by_token', {
      p_token: corps.token,
      p_affectation_token: corps.affectation_token,
    })) as {
      ok: boolean
      error?: string
      projet_id: string | null
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
    if (!ctx?.ok) return json({ ok: false, error: ctx?.error ?? 'acces_refuse' }, 403, CORS)

    const dossier: Dossier = {
      adresse: ctx.client_adresse,
      codePostal: ctx.client_code_postal,
      ville: ctx.client_ville,
      point: ctx.longitude != null && ctx.latitude != null ? [Number(ctx.longitude), Number(ctx.latitude)] : null,
    }

    // 0. Une adresse cherchée à la main : la maison de CETTE adresse, sans rien
    //    enregistrer. C'est le « Oui » de l'artisan, ou sa mesure, qui la retiendra.
    const choisie = lireAdresseChoisie(corps.adresse)
    if (choisie) return json(await maisonDeLAdresseChoisie(dossier, choisie), 200, CORS)

    // 1. Une maison confirmée par un humain, ou choisie par l'artisan : on la
    //    reprend telle quelle, sans rien recalculer.
    const humaine = ctx.batiment_confirme_at || ctx.batiment_source === 'artisan' || ctx.batiment_source === 'agence'
    if (ctx.batiment_cleabs && humaine && !corps.rafraichir) {
      const point: [number, number] | null =
        ctx.batiment_lon != null && ctx.batiment_lat != null ? [Number(ctx.batiment_lon), Number(ctx.batiment_lat)] : null
      const r = await maisonConfirmee(dossier, ctx.batiment_cleabs, point)
      if (r) return json(r, 200, CORS)
    }

    // 2. L'adresse du dossier, puis sa maison.
    const { reponse, aGarder } = await identifierMaison(dossier)

    // 3. On garde le calcul — y compris « aucune maison sûre », pour qu'un
    //    ancien bâtiment calculé ne survive pas à un calcul qui l'a écarté.
    //    Une maison confirmée par un humain, elle, ne bouge pas : la fonction
    //    SQL le refuse d'elle-même.
    if (ctx.projet_id) {
      await rpc('enregistrer_batiment_projet', {
        p_projet_id: ctx.projet_id,
        p_cleabs: aGarder.cleabs,
        p_source: aGarder.source,
        p_adresse: aGarder.adresse,
        p_score: aGarder.score,
        p_lon: aGarder.point?.[0] ?? null,
        p_lat: aGarder.point?.[1] ?? null,
      }).catch(() => undefined)
    }
    return json(reponse, 200, CORS)
  } catch (e) {
    console.error('batiment-chantier', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
