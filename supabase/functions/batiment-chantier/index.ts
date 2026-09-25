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
// pré-mesure des chantiers (sans écran) a besoin du même calcul.

import {
  lieuSaisi,
  memeCommune,
  memeRue,
  numeroNormalise,
  numeroSaisi,
  requeteAdresse,
  voieSaisie,
} from '../_adresse.ts'

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

/** Un appel HTTP avec délai de garde et réessais : l'IGN et le RNB étranglent parfois. */
async function lireJson(url: string, essais = 2): Promise<unknown> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
      clearTimeout(t)
      if (!r.ok) throw new Error(`http_${r.status}`)
      const texte = await r.text()
      // Un corps vide en HTTP 200 est une panne, pas une réponse.
      if (!texte.trim()) throw new Error('reponse_vide')
      return JSON.parse(texte)
    } catch (e) {
      derniere = e
      await new Promise((ok) => setTimeout(ok, 700 * (i + 1)))
    }
  }
  throw derniere instanceof Error ? derniere : new Error('injoignable')
}

// ---------- Adresse (BAN) ----------

interface AdresseBan {
  id: string
  label: string
  score: number
  type: string
  commune: string
  codePostal: string
  /** La commune d'avant une fusion (« Salenthal » dans Sommerau), quand la BAN la connaît. */
  ancienne: string | null
  rue: string
  numero: string | null
  point: [number, number]
}

async function chercherAdresse(q: string, codePostal: string | null): Promise<AdresseBan[]> {
  const u = new URL('https://api-adresse.data.gouv.fr/search/')
  u.searchParams.set('q', q)
  u.searchParams.set('limit', '5')
  if (codePostal && /^\d{5}$/.test(codePostal)) u.searchParams.set('postcode', codePostal)
  const j = (await lireJson(u.toString())) as { features?: { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[] }
  return (j.features ?? []).map((f) => ({
    id: String(f.properties.id ?? ''),
    label: String(f.properties.label ?? ''),
    score: Number(f.properties.score ?? 0),
    type: String(f.properties.type ?? ''),
    commune: String(f.properties.city ?? ''),
    codePostal: String(f.properties.postcode ?? ''),
    ancienne: typeof f.properties.oldcity === 'string' ? f.properties.oldcity : null,
    rue: String(f.properties.street ?? f.properties.name ?? ''),
    numero: f.properties.housenumber != null ? String(f.properties.housenumber) : null,
    point: f.geometry.coordinates,
  }))
}

/**
 * Le nom saisi est-il celui d'une commune ? « Saint-Aygulf » n'en est pas une :
 * c'est un quartier de Fréjus, que la BAN rend donc sous « Fréjus ». Dans le
 * doute (service injoignable), on le tient pour une commune : mieux vaut une
 * question de trop qu'une maison dans la mauvaise ville.
 */
async function estUneCommune(nom: string): Promise<boolean> {
  const j = await lireJson(
    `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&fields=nom&limit=5`,
  ).catch(() => null)
  if (!Array.isArray(j)) return true
  return j.some((c) => memeCommune((c as { nom?: string }).nom, nom))
}

// ---------- Bâtiments (RNB, BD TOPO) ----------

/** Les bâtiments que le RNB rattache à une adresse : identifiant BD TOPO, et un point DANS le bâtiment. */
async function batimentsRnb(cleBan: string): Promise<{ cleabs: string; point: [number, number] | null }[]> {
  if (!cleBan) return []
  const j = (await lireJson(
    `https://rnb-api.beta.gouv.fr/api/alpha/buildings/?cle_interop_ban=${encodeURIComponent(cleBan)}`,
  )) as {
    results?: {
      status?: string
      point?: { coordinates?: [number, number] }
      ext_ids?: { source?: string; id?: string }[]
    }[]
  }
  const sortie: { cleabs: string; point: [number, number] | null }[] = []
  for (const b of j.results ?? []) {
    if (b.status && b.status !== 'constructed') continue
    for (const e of b.ext_ids ?? []) {
      if (e.source === 'bdtopo' && e.id) sortie.push({ cleabs: e.id, point: b.point?.coordinates ?? null })
    }
  }
  return sortie
}

interface BatimentBd {
  cleabs: string
  contour: [number, number][]
  aire: number
  usage: string | null
  /** Hauteur à la gouttière selon la BD TOPO, quand elle la connaît. */
  hauteur: number | null
}

const WFS =
  'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
  '&TYPENAMES=BDTOPO_V3:batiment&SRSNAME=CRS:84&OUTPUTFORMAT=application/json'

function premierAnneau(g: { type?: string; coordinates?: unknown } | undefined): [number, number][] {
  const c = g?.coordinates as unknown[] | undefined
  if (!Array.isArray(c) || !c.length) return []
  const anneau = (g?.type === 'MultiPolygon' ? (c[0] as unknown[])?.[0] : c[0]) as number[][] | undefined
  if (!Array.isArray(anneau)) return []
  const pts = anneau.filter((p) => Array.isArray(p) && typeof p[0] === 'number').map((p) => [p[0], p[1]] as [number, number])
  if (pts.length > 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]]
    if (a[0] === b[0] && a[1] === b[1]) pts.pop()
  }
  return pts
}

/** Aire plane locale, en m² : suffisante pour comparer des bâtiments voisins. */
function aire(P: [number, number][]): number {
  if (P.length < 3) return 0
  const lat = P.reduce((s, p) => s + p[1], 0) / P.length
  const k = Math.cos((lat * Math.PI) / 180) * 111320
  let s = 0
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]
    s += a[0] * k * (b[1] * 111320) - b[0] * k * (a[1] * 111320)
  }
  return Math.abs(s) / 2
}

async function lireBatiments(filtre: string): Promise<BatimentBd[]> {
  const j = (await lireJson(`${WFS}&COUNT=50&CQL_FILTER=${encodeURIComponent(filtre)}`)) as {
    features?: { properties: Record<string, unknown>; geometry: { type?: string; coordinates?: unknown } }[]
  }
  return (j.features ?? [])
    .map((f) => {
      const contour = premierAnneau(f.geometry)
      return {
        cleabs: String(f.properties.cleabs ?? ''),
        contour,
        aire: aire(contour),
        usage: typeof f.properties.usage_1 === 'string' ? (f.properties.usage_1 as string) : null,
        hauteur: typeof f.properties.hauteur === 'number' && f.properties.hauteur > 0 ? (f.properties.hauteur as number) : null,
      }
    })
    .filter((b) => b.cleabs && b.contour.length >= 3)
}

const f7 = (n: number) => n.toFixed(7)
/**
 * Des bâtiments par identifiant — en passant par l'INDEX SPATIAL.
 *
 * Le filtre `cleabs IN (…)` seul prend 25 secondes : le champ n'est pas indexé
 * côté IGN. Une petite zone autour d'un point connu répond en une seconde ; on
 * y garde ensuite les bons identifiants. Sans point, on se résout au filtre lent.
 */
async function parCleabs(ids: string[], points: ([number, number] | null)[] = []): Promise<BatimentBd[]> {
  const voulus = new Set(ids)
  const connus = points.filter((p): p is [number, number] => !!p)
  if (connus.length) {
    const lon = connus.map((p) => p[0]), lat = connus.map((p) => p[1])
    const m = 40
    const dLat = m / 111320
    const dLon = m / (111320 * Math.cos((lat[0] * Math.PI) / 180))
    const trouves = (await lireBatiments(
      `BBOX(geometrie,${f7(Math.min(...lon) - dLon)},${f7(Math.min(...lat) - dLat)},${f7(Math.max(...lon) + dLon)},${f7(Math.max(...lat) + dLat)},'EPSG:4326')`,
    )).filter((b) => voulus.has(b.cleabs))
    if (trouves.length) return trouves
  }
  return lireBatiments(`cleabs IN (${ids.map((i) => `'${i.replace(/'/g, '')}'`).join(',')})`)
}
const contenant = (p: [number, number]) => lireBatiments(`INTERSECTS(geometrie,SRID=4326;POINT(${f7(p[0])} ${f7(p[1])}))`)

/** Les bâtiments dans un carré de 2 × `m` mètres autour du point. */
function autour(p: [number, number], m: number) {
  const dLat = m / 111320
  const dLon = m / (111320 * Math.cos((p[1] * Math.PI) / 180))
  return lireBatiments(`BBOX(geometrie,${f7(p[0] - dLon)},${f7(p[1] - dLat)},${f7(p[0] + dLon)},${f7(p[1] + dLat)},'EPSG:4326')`)
}

/**
 * Assez haut pour qu'on y vive : une maison de plain-pied a sa gouttière vers
 * 2,5 m. En dessous, c'est un abri, un auvent, une terrasse couverte — à Nîmes,
 * un « résidentiel » de 146 m² haut de 1,7 m, à côté de la maison de 82 m².
 */
const assezHaut = (b: BatimentBd) => b.hauteur == null || b.hauteur >= 2.5

/** Une maison, pas un abri ni un garage : résidentielle, ou d'au moins 40 m² hors annexes, et assez haute. */
const habitable = (b: BatimentBd) =>
  b.usage !== 'Annexe' && assezHaut(b) && (b.usage === 'Résidentiel' || b.aire >= 40)

/** Parmi les bâtiments d'une adresse, lequel est la maison : d'abord ce qui s'habite, puis le plus grand. */
const rangMaison = (b: BatimentBd) => (b.usage === 'Résidentiel' && assezHaut(b) ? 2 : habitable(b) ? 1 : 0)

/** Le centre du contour (moyenne des sommets) : assez pour recentrer la carte. */
const centreDe = (b: BatimentBd): [number, number] => [
  b.contour.reduce((s, p) => s + p[0], 0) / b.contour.length,
  b.contour.reduce((s, p) => s + p[1], 0) / b.contour.length,
]

/** Distance du point au polygone (0 s'il est dedans), en mètres, approximation plane. */
function distancePolygone(p: [number, number], P: [number, number][]): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320
  const X = (q: [number, number]) => [(q[0] - p[0]) * k, (q[1] - p[1]) * 111320]
  let dedans = false
  let min = Infinity
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = X(P[j]), [bx, by] = X(P[i])
    if ((by > 0) !== (ay > 0) && 0 < ((ax - bx) * (0 - by)) / (ay - by) + bx) dedans = !dedans
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return dedans ? 0 : min
}

// ---------- La réponse ----------

type Confiance = 'confirmee' | 'officielle' | 'a_confirmer' | 'aucune'

interface Reponse {
  ok: true
  confiance: Confiance
  methode: 'confirmee' | 'rnb' | 'contenant' | 'proximite' | null
  principal: { cleabs: string; contour: [number, number][]; aire: number } | null
  autres: string[]
  point: [number, number] | null
  adresse_retrouvee: string | null
  score: number | null
  commune_saisie: string | null
  commune_retrouvee: string | null
  commune_differente: boolean
  /** Le numéro saisi, quand la BAN en a retrouvé un autre dans la même rue. */
  numero_saisi: string | null
  message: string | null
}

/**
 * Le score à partir duquel une adresse retrouvée ne demande pas confirmation.
 * 0,8 pour commencer ; le banc de justesse le calibrera. Le lien RNB, lui, est
 * exigé dans tous les cas pour parler de maison « officielle ».
 */
const SEUIL_SCORE = 0.8

/**
 * Le centre de la commune, quand l'adresse n'a pas été reconnue. La position
 * enregistrée sur le projet est bien moins sûre : un géocodage fait à la
 * création, retombé ailleurs — à Abbans-Dessus, vingt kilomètres plus loin.
 */
async function centreCommune(nom: string | null, codePostal: string | null): Promise<[number, number] | null> {
  if (!codePostal && !nom) return null
  const u = new URL('https://geo.api.gouv.fr/communes')
  if (codePostal && /^\d{5}$/.test(codePostal)) u.searchParams.set('codePostal', codePostal)
  else if (nom) u.searchParams.set('nom', nom)
  else return null
  u.searchParams.set('fields', 'nom,centre')
  const j = (await lireJson(u.toString()).catch(() => null)) as
    | { nom?: string; centre?: { coordinates?: [number, number] } }[]
    | null
  if (!Array.isArray(j) || !j.length) return null
  const c = (nom ? j.find((x) => memeCommune(x.nom, nom)) : undefined) ?? (j.length === 1 ? j[0] : undefined)
  return c?.centre?.coordinates ?? null
}

/** L'adresse choisie par l'artisan, si elle est bien formée : un identifiant BAN et un point. */
function lireAdresseChoisie(a: { id?: unknown; label?: unknown; point?: unknown } | undefined) {
  if (!a || typeof a.id !== 'string' || !/^[\w-]{5,64}$/.test(a.id) || !Array.isArray(a.point)) return null
  const [lon, lat] = a.point.map(Number)
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null
  return { id: a.id, label: typeof a.label === 'string' ? a.label.slice(0, 200) : null, point: [lon, lat] as [number, number] }
}

const AUCUN_BATIMENT = 'Aucun bâtiment n’est tracé à cette adresse : touchez la maison sur la carte, ou dessinez-la.'

/** Le bâtiment d'une adresse retrouvée : RNB d'abord, sinon la maison qui contient le point, sinon la plus proche. */
async function batimentDeLAdresse(numero: { id: string; point: [number, number] }): Promise<{
  methode: 'rnb' | 'contenant' | 'proximite'
  principal: BatimentBd
  autres: BatimentBd[]
  liens: { cleabs: string; point: [number, number] | null }[]
} | null> {
  let methode: 'rnb' | 'contenant' | 'proximite' = 'rnb'
  const liens = await batimentsRnb(numero.id).catch(() => [])
  let candidats = liens.length ? await parCleabs(liens.map((l) => l.cleabs), liens.map((l) => l.point)) : []
  // Sans lien officiel, on ne retient qu'une maison : à Dimbsthal, le seul
  // bâtiment à moins de vingt mètres du point était un abri de 29 m².
  if (!candidats.length) {
    candidats = (await contenant(numero.point)).filter(habitable)
    methode = 'contenant'
  }
  if (!candidats.length) {
    const proches = (await autour(numero.point, 40))
      .map((b) => ({ b, d: distancePolygone(numero.point, b.contour) }))
      .filter((x) => x.d <= 20 && habitable(x.b))
      .sort((x, y) => x.d - y.d)
    if (proches.length) {
      candidats = [proches[0].b]
      methode = 'proximite'
    }
  }

  if (!candidats.length) return null

  // Plusieurs bâtiments pour une adresse (maison et garage, 7 cas sur 23) :
  // la maison est ce qui s'habite, puis le plus grand.
  candidats.sort((a, b) => rangMaison(b) - rangMaison(a) || b.aire - a.aire)
  const [principal, ...autres] = candidats
  return { methode, principal, autres, liens }
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

    const base: Omit<Reponse, 'confiance' | 'methode' | 'principal' | 'message'> = {
      ok: true,
      autres: [],
      point: ctx.longitude != null && ctx.latitude != null ? [ctx.longitude, ctx.latitude] : null,
      adresse_retrouvee: null,
      score: null,
      commune_saisie: ctx.client_ville,
      commune_retrouvee: null,
      commune_differente: false,
      numero_saisi: null,
    }

    // 0. Une adresse cherchée à la main : la maison de CETTE adresse, sans rien
    //    enregistrer. C'est le « Oui » de l'artisan, ou sa mesure, qui la retiendra.
    const choisie = lireAdresseChoisie(corps.adresse)
    if (choisie) {
      const trouve = await batimentDeLAdresse(choisie)
      const infos = { ...base, point: choisie.point, adresse_retrouvee: choisie.label }
      if (!trouve) {
        return json({ ...infos, confiance: 'aucune', methode: null, principal: null, message: AUCUN_BATIMENT } satisfies Reponse, 200, CORS)
      }
      return json({
        ...infos,
        confiance: trouve.methode === 'rnb' ? 'officielle' : 'a_confirmer',
        methode: trouve.methode,
        principal: { cleabs: trouve.principal.cleabs, contour: trouve.principal.contour, aire: Math.round(trouve.principal.aire) },
        autres: trouve.autres.map((b) => b.cleabs),
        message: null,
      } satisfies Reponse, 200, CORS)
    }

    // 1. Une maison confirmée par un humain, ou choisie par l'artisan : on la
    //    reprend telle quelle, sans rien recalculer.
    const humaine = ctx.batiment_confirme_at || ctx.batiment_source === 'artisan' || ctx.batiment_source === 'agence'
    if (ctx.batiment_cleabs && humaine && !corps.rafraichir) {
      const [b] = await parCleabs(
        [ctx.batiment_cleabs],
        ctx.batiment_lon != null && ctx.batiment_lat != null ? [[Number(ctx.batiment_lon), Number(ctx.batiment_lat)]] : [],
      )
      if (b) {
        return json({
          ...base,
          confiance: 'confirmee',
          methode: 'confirmee',
          principal: { cleabs: b.cleabs, contour: b.contour, aire: Math.round(b.aire) },
          point: centreDe(b),
          message: null,
        } satisfies Reponse, 200, CORS)
      }
    }

    // 2. L'adresse.
    const adresse = (ctx.client_adresse ?? '').trim()
    if (!adresse) {
      return json({
        ...base,
        point: (await centreCommune(ctx.client_ville, ctx.client_code_postal)) ?? base.point,
        confiance: 'aucune',
        methode: null,
        principal: null,
        message: base.point
          ? 'Aucune adresse au dossier : la carte s’ouvre sur la commune. Cherchez l’adresse, ou touchez la maison.'
          : 'Ce chantier n’a ni adresse ni position. Cherchez l’adresse.',
      } satisfies Reponse, 200, CORS)
    }
    const lieu = lieuSaisi(adresse)
    const codePostal = ctx.client_code_postal ?? lieu.codePostal
    const communeSaisie = ctx.client_ville ?? lieu.commune
    const voie = voieSaisie(adresse)
    base.commune_saisie = communeSaisie

    const resultats = await chercherAdresse(requeteAdresse(adresse, codePostal, ctx.client_ville), codePostal)
    // Le premier numéro DANS LA BONNE RUE — pas le premier numéro venu.
    const numero = resultats.find((r) => r.type === 'housenumber' && memeRue(voie, r.rue)) ?? null
    const rue = numero ?? resultats.find((r) => r.type === 'street' && memeRue(voie, r.rue)) ?? null
    const meilleur = rue ?? resultats[0]
    if (!meilleur || !rue) {
      // Rien, ou une AUTRE rue : son point n'aiderait qu'à égarer l'artisan.
      return json({
        ...base,
        point: (await centreCommune(communeSaisie, codePostal)) ?? base.point,
        confiance: 'aucune',
        methode: null,
        principal: null,
        message: `L’adresse « ${voie || adresse} » n’est pas reconnue${communeSaisie ? ` à ${communeSaisie}` : ''}. Cherchez-la, ou touchez la maison sur la carte.`,
      } satisfies Reponse, 200, CORS)
    }

    let communeDifferente =
      !!communeSaisie && !memeCommune(communeSaisie, meilleur.commune) && !memeCommune(communeSaisie, meilleur.ancienne)
    let score = meilleur.score
    // Un quartier ou un hameau noté à la place de la commune, dans le bon code
    // postal, n'est pas une autre commune. Il fait pourtant baisser le score
    // (0,609 pour « Saint-Aygulf », rendu « Fréjus ») : on le mesure sans lui.
    if (communeDifferente && codePostal && meilleur.codePostal === codePostal && !(await estUneCommune(communeSaisie!))) {
      communeDifferente = false
      const sansQuartier = await chercherAdresse(`${voie} ${codePostal}`, codePostal).catch(() => [])
      score = sansQuartier.find((r) => r.id === meilleur.id)?.score ?? score
    }
    const infos = {
      ...base,
      point: meilleur.point,
      adresse_retrouvee: meilleur.label,
      score: Math.round(score * 1000) / 1000,
      commune_retrouvee: meilleur.commune,
      commune_differente: communeDifferente,
    }

    if (!numero) {
      return json({
        ...infos,
        confiance: 'aucune',
        methode: null,
        principal: null,
        message: `Seule la rue est reconnue (${meilleur.rue}), pas le numéro : touchez la bonne maison sur la carte.`,
      } satisfies Reponse, 200, CORS)
    }
    // La BAN rend le numéro le plus proche quand elle ne connaît pas le bon.
    const autreNumero = numeroNormalise(numeroSaisi(voie)) !== numeroNormalise(numero.numero)
    if (autreNumero) infos.numero_saisi = numeroSaisi(voie)

    // 3. Le bâtiment de cette adresse.
    const trouve = await batimentDeLAdresse(numero)
    if (!trouve) {
      return json({
        ...infos,
        confiance: 'aucune',
        methode: null,
        principal: null,
        message: AUCUN_BATIMENT,
      } satisfies Reponse, 200, CORS)
    }
    const { methode, principal, autres, liens } = trouve

    const officielle = methode === 'rnb' && score >= SEUIL_SCORE && !communeDifferente && !autreNumero
    const confiance: Confiance = officielle ? 'officielle' : 'a_confirmer'

    // On garde le calcul — sauf si un humain a déjà tranché (la fonction SQL
    // le refuse d'elle-même).
    // Un point près de la maison, pour la relire en une seconde : celui du RNB
    // quand il existe (il est DANS le bâtiment), sinon le centre du contour.
    const centre = liens.find((l) => l.cleabs === principal.cleabs)?.point ?? centreDe(principal)
    if (ctx.projet_id) {
      await rpc('enregistrer_batiment_projet', {
        p_projet_id: ctx.projet_id,
        p_cleabs: principal.cleabs,
        p_source: methode,
        p_adresse: numero.label,
        p_score: infos.score,
        p_lon: Number(centre[0].toFixed(7)),
        p_lat: Number(centre[1].toFixed(7)),
      }).catch(() => undefined)
    }

    return json({
      ...infos,
      confiance,
      methode,
      principal: { cleabs: principal.cleabs, contour: principal.contour, aire: Math.round(principal.aire) },
      autres: autres.map((b) => b.cleabs),
      message: null,
    } satisfies Reponse, 200, CORS)
  } catch (e) {
    console.error('batiment-chantier', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
