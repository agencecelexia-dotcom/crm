// Edge Function : les photos de façade d'une maison, et ce qu'on y lit.
//
// - « chercher » : les photos de rue (Panoramax, et Mapillary quand la clé
//   MAPILLARY_TOKEN est posée) ; pour chaque façade, la meilleure vue — de
//   face, sans bâtiment devant (`_vue-facade.ts`) — copiée dans notre
//   stockage avec son auteur et sa licence.
// - « deposer » puis « enregistrer » : la photo que l'artisan prend lui-même,
//   quand la rue n'en a pas (le cas le plus sûr).
// - « lire » : Claude lit la photo — la façade, ses ouvertures, sa hauteur —
//   et `_ouvertures.ts` en tire la surface à déduire. Vingt lectures par
//   artisan et par jour : chaque lecture coûte quelques centimes.
//
// Accès par le jeton de l'artisan, comme les autres fonctions du métré.

import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0'
import { depuisLambert93, versLambert93 } from '../_calcul-toit.ts'
import type { Point } from '../_geometrie.ts'
import { consigne, SCHEMA_LECTURE, tirerOuvertures, type LectureVision } from '../_ouvertures.ts'
import { photosMapillary, photosPanoramax, type PhotoRue } from '../_photos-rue.ts'
import type { Releve } from '../_releve.ts'
import { releveUtilisable } from '../_releve-retenu.ts'
import { vuesDesFacades } from '../_vue-facade.ts'

const MODELE = 'claude-opus-5'
const LECTURES_PAR_JOUR = 20

const URL_BASE = () => Deno.env.get('SUPABASE_URL')!
const CLE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const entetes = (extra: Record<string, string> = {}) => ({
  apikey: CLE(),
  authorization: `Bearer ${CLE()}`,
  'content-type': 'application/json',
  ...extra,
})

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

async function rest<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${URL_BASE()}/rest/v1/${chemin}`, { ...init, headers: entetes(init.headers as Record<string, string>) })
  if (!r.ok) throw new Error(`rest ${r.status} ${(await r.text()).slice(0, 200)}`)
  return (r.status === 204 ? null : await r.json()) as T
}

async function artisanDe(jeton: string): Promise<string | null> {
  const [a] = await rest<{ id: string }[]>(`artisans?token=eq.${encodeURIComponent(jeton)}&ecarte_at=is.null&select=id`)
  return a?.id ?? null
}

async function releveDe(cleabs: string): Promise<{ releve: Releve; version: number } | null> {
  const [l] = await rest<{ releve: Releve; version: number }[]>(
    `releve_batiment?cleabs=eq.${encodeURIComponent(cleabs)}&statut=eq.fait&select=releve,version`,
  )
  return l && releveUtilisable(l.releve) ? l : null
}

/** Les voisins gardés avec l'extrait du relevé, déplacés comme la maison. */
async function voisinsDe(cleabs: string, version: number, r: Releve): Promise<Point[][]> {
  const res = await fetch(`${URL_BASE()}/storage/v1/object/releves/${cleabs}/v${version}/entree.json`, { headers: entetes() })
  if (!res.ok) return []
  const e = (await res.json()) as { voisins?: { contour: Point[] }[] }
  return (e.voisins ?? []).map((v) =>
    v.contour.map(([lon, lat]) => {
      const [x, y] = versLambert93(lon, lat)
      return depuisLambert93(x + r.recalage.dx, y + r.recalage.dy)
    }),
  )
}

async function signer(chemin: string): Promise<string | null> {
  const r = await fetch(`${URL_BASE()}/storage/v1/object/sign/facades/${chemin}`, {
    method: 'POST',
    headers: entetes(),
    body: JSON.stringify({ expiresIn: 3600 }),
  })
  if (!r.ok) return null
  const { signedURL } = (await r.json()) as { signedURL?: string }
  return signedURL ? `${URL_BASE()}/storage/v1${signedURL}` : null
}

/** Copie l'image de la photo dans notre stockage (le site n'autorise pas les hôtes des fournisseurs). */
async function copier(url: string, chemin: string) {
  const img = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!img.ok) throw new Error(`image_${img.status}`)
  const octets = new Uint8Array(await img.arrayBuffer())
  const r = await fetch(`${URL_BASE()}/storage/v1/object/facades/${chemin}`, {
    method: 'POST',
    headers: entetes({ 'content-type': 'image/jpeg', 'x-upsert': 'true' }),
    body: octets,
  })
  if (!r.ok) throw new Error(`stockage_${r.status}`)
}

interface LignePhoto {
  id: string
  cleabs: string
  orientation: string
  source: 'panoramax' | 'mapillary' | 'artisan'
  photo_ref: string
  chemin: string
  auteur: string | null
  licence: string | null
  page: string | null
  pris_le: string | null
  largeur: number | null
  hauteur: number | null
  note: number | null
  distance_m: number | null
  incidence: number | null
  colonnes: number[] | null
  lecture: unknown
  lu_le: string | null
}

const COLONNES =
  'id,cleabs,orientation,source,photo_ref,chemin,auteur,licence,page,pris_le,largeur,hauteur,note,distance_m,incidence,colonnes,lecture,lu_le'

async function photosGardees(cleabs: string): Promise<LignePhoto[]> {
  return await rest<LignePhoto[]>(`facade_photo?cleabs=eq.${encodeURIComponent(cleabs)}&select=${COLONNES}&order=cree_le.desc`)
}

async function avecLiens(lignes: LignePhoto[]) {
  return await Promise.all(lignes.map(async (l) => ({ ...l, url: await signer(l.chemin) })))
}

/** Chercher les photos de rue et garder la meilleure de chaque façade. */
async function chercher(cleabs: string): Promise<LignePhoto[]> {
  const gardees = await photosGardees(cleabs)
  if (gardees.some((p) => p.source !== 'artisan')) return gardees
  const l = await releveDe(cleabs)
  if (!l) return gardees
  const r = l.releve
  const lon = r.murs.reduce((s, p) => s + p[0], 0) / r.murs.length
  const lat = r.murs.reduce((s, p) => s + p[1], 0) / r.murs.length
  const jeton = Deno.env.get('MAPILLARY_TOKEN')
  const [pano, mapi] = await Promise.all([
    photosPanoramax(lon, lat).catch(() => [] as PhotoRue[]),
    jeton ? photosMapillary(lon, lat, jeton).catch(() => [] as PhotoRue[]) : Promise.resolve([] as PhotoRue[]),
  ])
  const obstacles = [...(await voisinsDe(cleabs, l.version, r)), r.murs]
  const murs = r.facades.map((f) => ({
    orientation: f.orientation,
    azimut: f.azimut,
    longueur: f.longueur,
    a: f.a,
    b: f.b,
    surface: f.surfaceLibre,
  }))
  const vues = vuesDesFacades(murs, [...pano, ...mapi], obstacles, 1)
  for (const [orientation, [v]] of Object.entries(vues)) {
    if (!v) continue
    const chemin = `${cleabs}/${v.photo.source}-${v.photo.id}.jpg`
    try {
      await copier(v.photo.url, chemin)
    } catch (e) {
      console.error('facade-photo: copie', v.photo.url, e)
      continue
    }
    await rest('facade_photo?on_conflict=cleabs,orientation,source,photo_ref', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        cleabs,
        orientation,
        source: v.photo.source,
        photo_ref: v.photo.id,
        chemin,
        auteur: v.photo.auteur,
        licence: v.photo.licence,
        page: v.photo.page,
        pris_le: v.photo.date,
        lon: v.photo.lon,
        lat: v.photo.lat,
        cap: v.photo.cap,
        champ: v.photo.champ,
        largeur: v.photo.largeur,
        hauteur: v.photo.hauteur,
        note: v.note,
        distance_m: v.distance,
        incidence: v.incidence,
        colonnes: v.colonnes,
      }),
    })
  }
  return await photosGardees(cleabs)
}

/** Lire une photo : Claude, puis la surface d'ouvertures rapportée au mur relevé. */
async function lire(photo: LignePhoto, artisan: string) {
  const l = await releveDe(photo.cleabs)
  if (!l) return { ok: false, error: 'releve_absent' }
  const murs = l.releve.facades.filter((f) => f.orientation === photo.orientation && f.surfaceLibre > 0)
  const mur = murs.sort((a, b) => b.surfaceLibre - a.surfaceLibre)[0]
  if (!mur) return { ok: false, error: 'facade_introuvable' }
  const url = await signer(photo.chemin)
  if (!url) return { ok: false, error: 'image_introuvable' }
  const cle = Deno.env.get('ANTHROPIC_API_KEY')
  if (!cle) return { ok: false, error: 'vision_indisponible' }

  const contexte = {
    orientation: photo.orientation,
    origine: photo.source === 'artisan' ? ('artisan' as const) : ('rue' as const),
    longueur: mur.longueur,
    hauteurGouttiere: mur.hauteurBasse,
    type: mur.type,
    colonnes: photo.colonnes && photo.colonnes.length === 2 ? ([photo.colonnes[0], photo.colonnes[1]] as [number, number]) : null,
    distance: photo.distance_m,
  }
  const client = new Anthropic({ apiKey: cle })
  // Repli automatique sur un autre modèle si celui-ci décline la demande.
  const requete = {
    model: MODELE,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: { type: 'json_schema', schema: SCHEMA_LECTURE } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url } },
          { type: 'text', text: consigne(contexte) },
        ],
      },
    ],
  }
  let reponse: Anthropic.Beta.BetaMessage
  try {
    reponse = await client.beta.messages.create(requete as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'vision_occupee' }
    if (e instanceof Anthropic.APIError) {
      console.error('facade-photo: vision', e.status, e.message)
      return { ok: false, error: 'vision_en_panne' }
    }
    throw e
  }
  if (reponse.stop_reason === 'refusal') return { ok: false, error: 'vision_refus' }
  const texte = reponse.content.find((b) => b.type === 'text')
  if (!texte || texte.type !== 'text') return { ok: false, error: 'vision_vide' }
  let vision: LectureVision
  try {
    vision = JSON.parse(texte.text) as LectureVision
  } catch {
    return { ok: false, error: 'vision_illisible' }
  }
  const proportions = photo.largeur && photo.hauteur ? photo.largeur / photo.hauteur : 4 / 3
  const resultat = tirerOuvertures(
    vision,
    { longueur: mur.longueur, hauteurGouttiere: mur.hauteurBasse },
    proportions,
    photo.source === 'artisan' ? null : photo.incidence,
    contexte.origine,
    photo.largeur ?? 2048,
  )
  const lecture = { vision, resultat, mur: { longueur: mur.longueur, hauteurGouttiere: mur.hauteurBasse, surfaceLibre: mur.surfaceLibre } }
  await rest(`facade_photo?id=eq.${photo.id}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ lecture, lu_le: new Date().toISOString(), lu_par: artisan, modele: reponse.model }),
  })
  return { ok: true, lecture }
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const b = ((await req.json().catch(() => ({}))) ?? {}) as {
      token?: string
      action?: string
      cleabs?: string
      orientation?: string
      id?: string
      chemin?: string
      largeur?: number
      hauteur?: number
    }
    if (typeof b.token !== 'string') return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    const artisan = await artisanDe(b.token)
    if (!artisan) return json({ ok: false, error: 'token_invalide' }, 403, CORS)
    const cleabs = typeof b.cleabs === 'string' && /^BATIMENT\d{16}$/.test(b.cleabs) ? b.cleabs : null
    const orientation = typeof b.orientation === 'string' && /^[a-z-]{3,12}$/.test(b.orientation) ? b.orientation : null

    if (b.action === 'chercher') {
      if (!cleabs) return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      return json({ ok: true, photos: await avecLiens(await chercher(cleabs)) }, 200, CORS)
    }

    if (b.action === 'deposer') {
      if (!cleabs || !orientation) return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      const chemin = `${cleabs}/artisan-${crypto.randomUUID()}.jpg`
      const r = await fetch(`${URL_BASE()}/storage/v1/object/upload/sign/facades/${chemin}`, {
        method: 'POST',
        headers: entetes(),
        // Le stockage refuse un corps vide annoncé comme JSON.
        body: '{}',
      })
      if (!r.ok) return json({ ok: false, error: 'depot_impossible' }, 500, CORS)
      const { url } = (await r.json()) as { url?: string }
      const jeton = url ? new URL(url, 'http://x').searchParams.get('token') : null
      return json({ ok: !!jeton, chemin, jeton }, 200, CORS)
    }

    if (b.action === 'enregistrer') {
      if (!cleabs || !orientation || typeof b.chemin !== 'string' || !b.chemin.startsWith(`${cleabs}/artisan-`)) {
        return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      }
      const dim = (v: unknown) => (typeof v === 'number' && v > 0 && v < 20000 ? Math.round(v) : null)
      const [ligne] = await rest<LignePhoto[]>('facade_photo?on_conflict=cleabs,orientation,source,photo_ref', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          cleabs,
          orientation,
          source: 'artisan',
          photo_ref: b.chemin,
          chemin: b.chemin,
          licence: 'photo de l’artisan',
          pris_le: new Date().toISOString(),
          largeur: dim(b.largeur),
          hauteur: dim(b.hauteur),
          deposee_par: artisan,
        }),
      })
      return json({ ok: true, photo: ligne ? { ...ligne, url: await signer(ligne.chemin) } : null }, 200, CORS)
    }

    if (b.action === 'lire') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/.test(b.id)) return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      const depuis = new Date(Date.now() - 86400e3).toISOString()
      const lues = await rest<{ id: string }[]>(`facade_photo?lu_par=eq.${artisan}&lu_le=gt.${depuis}&select=id`)
      if (lues.length >= LECTURES_PAR_JOUR) return json({ ok: false, error: 'quota_atteint' }, 200, CORS)
      const [photo] = await rest<LignePhoto[]>(`facade_photo?id=eq.${b.id}&select=${COLONNES}`)
      if (!photo) return json({ ok: false, error: 'photo_introuvable' }, 404, CORS)
      // Une photo déjà lue ne se relit pas : même réponse, sans nouveau coût.
      if (photo.lecture) return json({ ok: true, lecture: photo.lecture }, 200, CORS)
      return json(await lire(photo, artisan), 200, CORS)
    }

    return json({ ok: false, error: 'action_inconnue' }, 400, CORS)
  } catch (e) {
    console.error('facade-photo', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
