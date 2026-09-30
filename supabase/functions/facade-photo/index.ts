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
// - « ecarter » : l'artisan retire une ouverture lue (un reflet, une grille),
//   ou la remet ; la surface se recalcule sans elle.
// - « materiau_toit » : Claude lit le matériau du toit sur la photo aérienne
//   de l'IGN (`_materiaux.ts`) ; une lecture par maison, gardée avec son relevé.
//
// Après une lecture ou un retrait, les dossiers de métrés des chantiers de la
// maison suivent (`_dossier-serveur.ts`, sous l'interrupteur de la pré-mesure).
//
// Accès par le jeton de l'artisan, comme les autres fonctions du métré, ou
// par la session d'un membre actif de l'agence (`_membre.ts`).

import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0'
import { reporterAuDossier } from '../_dossier-serveur.ts'
import { JETON_AGENCE, jetonDe, membreActif } from '../_membre.ts'
import type { MateriauxGardes } from '../_materiaux.ts'
import { modeleVision } from '../_modeles.ts'
import { lireToit } from '../_materiaux-serveur.ts'
import { consigne, SCHEMA_LECTURE, tirerOuvertures, type LectureVision } from '../_ouvertures.ts'
import { chercherPhotosRue } from '../_photos-serveur.ts'
import type { Releve } from '../_releve.ts'
import { releveUtilisable } from '../_releve-retenu.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

// Une lecture de maison par l'IA lit chaque façade : de quoi en lire quelques-unes par jour.
const LECTURES_PAR_JOUR = 60

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

/** Qui appelle : un artisan (son jeton), ou un membre de l'agence (sa session). */
interface Acteur {
  id: string
  artisan: string | null
  membre: string | null
}

async function acteurDe(req: Request, jeton: string): Promise<Acteur | null> {
  if (jeton === JETON_AGENCE) {
    const m = await membreActif(jetonDe(req))
    return m ? { id: m.user_id, artisan: null, membre: m.user_id } : null
  }
  const [a] = await rest<{ id: string }[]>(`artisans?token=eq.${encodeURIComponent(jeton)}&ecarte_at=is.null&select=id`)
  return a ? { id: a.id, artisan: a.id, membre: null } : null
}

/** Les lectures de cet acteur depuis un jour : le quota se compte par personne. */
const filtreLecteur = (a: Acteur) => (a.artisan ? `lu_par=eq.${a.artisan}` : `lu_par_membre=eq.${a.membre}`)

async function releveDe(
  cleabs: string,
): Promise<{ releve: Releve; version: number; materiaux: MateriauxGardes | null } | null> {
  const [l] = await rest<{ releve: Releve; version: number; materiaux: MateriauxGardes | null }[]>(
    `releve_batiment?cleabs=eq.${encodeURIComponent(cleabs)}&statut=eq.fait&select=releve,version,materiaux`,
  )
  return l && releveUtilisable(l.releve) ? l : null
}

/** Les dossiers des chantiers de la maison suivent, après la réponse. */
function suivreAuDossier(cleabs: string) {
  EdgeRuntime.waitUntil(
    (async () => {
      const l = await releveDe(cleabs)
      if (l) await reporterAuDossier(cleabs, l.releve)
    })().catch((e) => console.error('facade-photo: dossier', e)),
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
  ecartees: number[]
}

const COLONNES =
  'id,cleabs,orientation,source,photo_ref,chemin,auteur,licence,page,pris_le,largeur,hauteur,note,distance_m,incidence,colonnes,lecture,lu_le,ecartees'

async function photosGardees(cleabs: string): Promise<LignePhoto[]> {
  return await rest<LignePhoto[]>(`facade_photo?cleabs=eq.${encodeURIComponent(cleabs)}&select=${COLONNES}&order=cree_le.desc`)
}

async function avecLiens(lignes: LignePhoto[]) {
  return await Promise.all(lignes.map(async (l) => ({ ...l, url: await signer(l.chemin) })))
}

/** Chercher les photos de rue (`_photos-serveur.ts`), puis rendre celles qu'on garde. */
async function chercher(cleabs: string): Promise<LignePhoto[]> {
  const gardees = await photosGardees(cleabs)
  if (gardees.some((p) => p.source !== 'artisan')) return gardees
  return (await chercherPhotosRue(cleabs)) ? await photosGardees(cleabs) : gardees
}

/** Lire une photo : Claude, puis la surface d'ouvertures rapportée au mur relevé. */
async function lire(photo: LignePhoto, acteur: Acteur) {
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
    model: modeleVision(),
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
    body: JSON.stringify({
      lecture,
      lu_le: new Date().toISOString(),
      lu_par: acteur.artisan,
      lu_par_membre: acteur.membre,
      modele: reponse.model,
    }),
  })
  suivreAuDossier(photo.cleabs)
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
      rang?: number
      ecartee?: boolean
      lire?: boolean
      chemin?: string
      largeur?: number
      hauteur?: number
    }
    if (typeof b.token !== 'string') return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    const acteur = await acteurDe(req, b.token)
    if (!acteur) return json({ ok: false, error: 'token_invalide' }, 403, CORS)
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
          deposee_par: acteur.artisan,
          deposee_par_membre: acteur.membre,
        }),
      })
      return json({ ok: true, photo: ligne ? { ...ligne, url: await signer(ligne.chemin) } : null }, 200, CORS)
    }

    if (b.action === 'lire') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/.test(b.id)) return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      const depuis = new Date(Date.now() - 86400e3).toISOString()
      const lues = await rest<{ id: string }[]>(`facade_photo?${filtreLecteur(acteur)}&lu_le=gt.${depuis}&select=id`)
      if (lues.length >= LECTURES_PAR_JOUR) return json({ ok: false, error: 'quota_atteint' }, 200, CORS)
      const [photo] = await rest<LignePhoto[]>(`facade_photo?id=eq.${b.id}&select=${COLONNES}`)
      if (!photo) return json({ ok: false, error: 'photo_introuvable' }, 404, CORS)
      // Une photo déjà lue ne se relit pas : même réponse, sans nouveau coût.
      if (photo.lecture) return json({ ok: true, lecture: photo.lecture }, 200, CORS)
      return json(await lire(photo, acteur), 200, CORS)
    }

    if (b.action === 'ecarter') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/.test(b.id) || !Number.isInteger(b.rang) || b.rang! < 0 || b.rang! > 200) {
        return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      }
      const [photo] = await rest<LignePhoto[]>(`facade_photo?id=eq.${b.id}&select=${COLONNES}`)
      if (!photo) return json({ ok: false, error: 'photo_introuvable' }, 404, CORS)
      const avant = new Set(photo.ecartees ?? [])
      if (b.ecartee === false) avant.delete(b.rang!)
      else avant.add(b.rang!)
      const ecartees = [...avant].sort((x, y) => x - y)
      await rest(`facade_photo?id=eq.${b.id}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ ecartees }),
      })
      suivreAuDossier(photo.cleabs)
      return json({ ok: true, ecartees }, 200, CORS)
    }

    if (b.action === 'materiau_toit') {
      if (!cleabs) return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
      const [garde] = await rest<{ materiaux: MateriauxGardes | null }[]>(
        `releve_batiment?cleabs=eq.${cleabs}&select=materiaux`,
      )
      if (garde?.materiaux?.toit) return json({ ok: true, materiaux: garde.materiaux }, 200, CORS)
      // L'écran demande d'abord ce qui est gardé, sans rien faire lire.
      if (b.lire !== true) return json({ ok: true, materiaux: null }, 200, CORS)
      // Le même quota que les photos : chaque lecture coûte quelques centimes.
      const depuis = new Date(Date.now() - 86400e3).toISOString()
      const [photosLues, toitsLus] = await Promise.all([
        rest<{ id: string }[]>(`facade_photo?${filtreLecteur(acteur)}&lu_le=gt.${depuis}&select=id`),
        rest<{ id: string }[]>(`releve_batiment?materiaux->>lu_par=eq.${acteur.id}&materiaux_le=gt.${depuis}&select=id`),
      ])
      if (photosLues.length + toitsLus.length >= LECTURES_PAR_JOUR) return json({ ok: false, error: 'quota_atteint' }, 200, CORS)
      const lu = await lireToit(cleabs, acteur.id)
      if (lu.ok) suivreAuDossier(cleabs)
      return json(lu, 200, CORS)
    }

    return json({ ok: false, error: 'action_inconnue' }, 400, CORS)
  } catch (e) {
    console.error('facade-photo', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
