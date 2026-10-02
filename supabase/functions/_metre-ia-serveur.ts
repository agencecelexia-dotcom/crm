// « Mesurer avec l'IA » : la lecture d'une maison, de bout en bout, côté
// serveur. Réservé à la fonction `metre-ia` (clé de service).
//
// LES ÉTAPES (chacune est écrite en base : l'écran les montre au fur et à mesure)
//
//  1. Le relevé LiDAR (gardé s'il existe, sinon fait maintenant).
//  2. Les niveaux du terrain (`_niveaux.ts`).
//  3. La photo aérienne de l'IGN et la carte des hauteurs (`_preuves.ts`).
//  4. L'IA lit la scène (`_scene-ia.ts`) : elle nomme et rattache, elle ne mesure pas.
//  5. Le contrôle : ce que les mesures contredisent est retiré ou dit (`validerScene`).
//  6. Les façades : la photo de rue de chaque mur, lue pour ses fenêtres et ses portes.
//
// La lecture ne lève jamais : un échec s'écrit comme tel, avec son motif.

import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0'
import { urlOrtho } from './_materiaux.ts'
import { modeleVision } from './_modeles.ts'
import { niveauxDuTerrain, type Niveaux } from './_niveaux.ts'
import { decoderNuage } from './_nuage.ts'
import { cadreDeLaMaison, carteDesHauteurs } from './_preuves.ts'
import { metreur, type Reponse, type ResultatMetreur } from './_metreur-ia.ts'
import { chargerOrtho, imageLaser, reliefDe, vueDessus, vueOblique, type Vue } from './_vues-ia.ts'
import { releverBatiment, VERSION_RELEVE, type Releve } from './_releve.ts'
import { releveUtilisable } from './_releve-retenu.ts'
import { releverEtGarder, releveGarde, rpcService } from './_releve-serveur.ts'
import { depuisLambert93 } from './_calcul-toit.ts'
import { enLambert, tracesDepuisReleve } from './_traces.ts'
import { consigneScene, SCHEMA_SCENE, validerScene, type SceneIA, type VerifScene } from './_scene-ia.ts'

/** À changer quand la lecture change : les lectures plus anciennes se refont à la demande. */
export const VERSION_METRE_IA = 1

const URL_BASE = () => Deno.env.get('SUPABASE_URL')!
const CLE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const entetes = (extra: Record<string, string> = {}) => ({
  apikey: CLE(),
  authorization: `Bearer ${CLE()}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${URL_BASE()}/rest/v1/${chemin}`, { ...init, headers: entetes(init.headers as Record<string, string>) })
  if (!r.ok) throw new Error(`rest ${r.status} ${(await r.text()).slice(0, 200)}`)
  return (r.status === 204 ? null : await r.json()) as T
}

export interface Etape {
  cle: string
  libelle: string
  ms: number
}

/** Ce que la fonction garde par maison. */
export interface LectureIA {
  cleabs: string
  version: number
  statut: 'en_cours' | 'fait' | 'echec'
  etape: string | null
  etapes: Etape[]
  scene: SceneIA | null
  /** Ce que l'IA a tracé (emprise, pans, terrasse…), et ce que le laser en a mesuré. */
  traces: ResultatMetreur['traces'] | null
  mesures: ResultatMetreur['mesures'] | null
  niveaux: Omit<Niveaux, 'grille'> | null
  verif: VerifScene | null
  modele: string | null
  cout: Record<string, unknown> | null
  motif: string | null
  demande_par: string | null
  demande_le: string
  fait_le: string | null
}

export async function lectureGardee(cleabs: string): Promise<LectureIA | null> {
  const [l] = await rest<LectureIA[]>(`metre_ia?cleabs=eq.${encodeURIComponent(cleabs)}&select=*`)
  return l ?? null
}

/** Combien de lectures cet acteur a-t-il lancées depuis un jour ? */
export async function lecturesDuJour(acteur: string): Promise<number> {
  const depuis = new Date(Date.now() - 86400e3).toISOString()
  const l = await rest<{ cleabs: string }[]>(`metre_ia?demande_par=eq.${encodeURIComponent(acteur)}&demande_le=gt.${depuis}&select=cleabs`)
  return l.length
}

/**
 * Prendre la main : vrai si la lecture peut commencer. Une lecture en cours
 * depuis moins de 8 minutes n'est pas doublée ; le reste (jamais faite, faite,
 * en échec, perdue) se relance — l'appelant a déjà décidé qu'il le voulait.
 */
export async function reserver(cleabs: string, acteur: string): Promise<boolean> {
  const maintenant = new Date().toISOString()
  const neuf = { cleabs, version: VERSION_METRE_IA, statut: 'en_cours', etape: 'Démarrage', etapes: [], demande_par: acteur, demande_le: maintenant }
  const cree = await fetch(`${URL_BASE()}/rest/v1/metre_ia?on_conflict=cleabs`, {
    method: 'POST',
    headers: entetes({ prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify(neuf),
  })
  if (cree.ok && ((await cree.json()) as unknown[]).length) return true
  const perdue = new Date(Date.now() - 8 * 60e3).toISOString()
  // Refaire une lecture : seulement si aucune n'est en cours (ou si elle est perdue).
  const pris = await rest<unknown[]>(`metre_ia?cleabs=eq.${encodeURIComponent(cleabs)}&or=(statut.neq.en_cours,demande_le.lt.${perdue})`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...neuf, scene: null, niveaux: null, verif: null, cout: null, modele: null, motif: null, fait_le: null }),
  })
  return pris.length > 0
}

async function ecrire(cleabs: string, champs: Record<string, unknown>) {
  await rest(`metre_ia?cleabs=eq.${encodeURIComponent(cleabs)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(champs) })
}

/** Ce qui a servi au relevé de la maison (zone, voisins, routes) : gardé avec ses points. */
async function entreeGardee(cleabs: string): Promise<{ zone: { minX: number; minY: number; maxX: number; maxY: number }; voisins: { contour: [number, number][] }[]; routes: [number, number][][] } | null> {
  const r = await fetch(`${URL_BASE()}/storage/v1/object/releves/${cleabs}/v${VERSION_RELEVE}/entree.json`, { headers: entetes() })
  if (!r.ok) return null
  const j = (await r.json()) as { zone?: never; voisins?: never; routes?: never }
  return j.zone ? (j as never) : null
}

/** Le nuage de points gardé avec le relevé (l'IGN met 20 à 75 s à le servir : on ne le relit pas). */
async function nuageGarde(cleabs: string) {
  const r = await fetch(`${URL_BASE()}/storage/v1/object/releves/${cleabs}/v${VERSION_RELEVE}/nuage.bin.gz`, { headers: entetes() })
  if (!r.ok) return null
  const flux = r.body!.pipeThrough(new DecompressionStream('gzip'))
  return decoderNuage(new Uint8Array(await new Response(flux).arrayBuffer()))
}

const base64 = (octets: Uint8Array) => {
  let b = ''
  for (let i = 0; i < octets.length; i += 0x8000) b += String.fromCharCode(...octets.subarray(i, i + 0x8000))
  return btoa(b)
}

/** L'appelant des façades : ce qu'il faut pour parler à `facade-photo` en son nom. */
export interface Appelant {
  /** Le jeton de l'artisan, ou « agence ». */
  token: string
  /** L'en-tête Authorization de l'appel d'origine (la session du membre de l'agence). */
  autorisation: string | null
  /** Identifie l'acteur dans le quota. */
  acteur: string
}

export interface Suivi {
  etapes: Etape[]
  t0: number
}

async function etape<T>(cleabs: string, suivi: Suivi, cle: string, libelle: string, f: () => Promise<T>): Promise<T> {
  await ecrire(cleabs, { etape: libelle, etapes: suivi.etapes })
  const t = performance.now()
  const r = await f()
  suivi.etapes.push({ cle, libelle, ms: Math.round(performance.now() - t) })
  await ecrire(cleabs, { etapes: suivi.etapes })
  return r
}

/** Lire une façade : chercher ses photos de rue, lire la meilleure. Ne lève jamais. */
async function lireFacades(cleabs: string, releve: Releve, a: Appelant): Promise<{ lues: number; sans_photo: string[]; erreurs: string[] }> {
  // Le banc n'a ni jeton d'artisan ni session : il ne lit pas les façades.
  if (a.token === 'banc') return { lues: 0, sans_photo: [], erreurs: [] }
  const appel = async (corps: Record<string, unknown>) => {
    const r = await fetch(`${URL_BASE()}/functions/v1/facade-photo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(a.autorisation ? { authorization: a.autorisation } : { authorization: `Bearer ${CLE()}` }) },
      body: JSON.stringify({ token: a.token, cleabs, ...corps }),
      signal: AbortSignal.timeout(120_000),
    })
    return (await r.json().catch(() => ({ ok: false, error: `http_${r.status}` }))) as { ok: boolean; error?: string; photos?: { id: string; orientation: string; note: number | null; lecture: unknown }[] }
  }
  const sortie = { lues: 0, sans_photo: [] as string[], erreurs: [] as string[] }
  const chercher = await appel({ action: 'chercher' })
  if (!chercher.ok) return { ...sortie, erreurs: [chercher.error ?? 'photos_indisponibles'] }
  const photos = chercher.photos ?? []
  const orientations = [...new Set(releve.facades.filter((f) => !f.retrait && f.surfaceLibre > 0).map((f) => f.orientation))]
  for (const o of orientations) {
    const candidates = photos.filter((p) => p.orientation === o).sort((x, y) => (y.note ?? 0) - (x.note ?? 0))
    const lue = candidates.find((p) => p.lecture)
    if (lue) {
      sortie.lues++
      continue
    }
    const meilleure = candidates[0]
    if (!meilleure) {
      sortie.sans_photo.push(o)
      continue
    }
    const lecture = await appel({ action: 'lire', id: meilleure.id })
    if (lecture.ok) sortie.lues++
    else sortie.erreurs.push(`${o} : ${lecture.error ?? 'échec'}`)
  }
  return sortie
}

/**
 * La lecture complète. Ne lève jamais : écrit `fait` ou `echec`.
 * `indice` : le point touché par l'artisan, pour retrouver la maison.
 */
export async function lireLaMaison(cleabs: string, indice: [number, number] | null, appelant: Appelant): Promise<void> {
  const suivi: Suivi = { etapes: [], t0: performance.now() }
  try {
    const cle = Deno.env.get('ANTHROPIC_API_KEY')
    if (!cle) throw new Error('vision_indisponible')

    // 1. Le relevé LiDAR.
    const releve = await etape(cleabs, suivi, 'releve', 'Points LiDAR de l’IGN', async () => {
      const gardee = await releveGarde(cleabs)
      if (gardee && releveUtilisable(gardee)) return gardee
      const fait = await releverEtGarder(cleabs, indice, { reporter: false })
      if (!fait.releve || !releveUtilisable(fait.releve)) throw new Error(`releve_${fait.statut}`)
      return fait.releve
    })

    // 2. Les niveaux du terrain.
    const niveaux = await etape(cleabs, suivi, 'niveaux', 'Niveaux du terrain', async () => {
      const nuage = await nuageGarde(cleabs)
      if (!nuage) throw new Error('nuage_absent')
      return { nuage, niveaux: niveauxDuTerrain(nuage, releve) }
    })

    // 3. Les deux images.
    const resolution = releve.ortho5cm === true ? 5 : 20
    const cadre = cadreDeLaMaison(releve, resolution)
    const images = await etape(cleabs, suivi, 'images', 'Photo aérienne et carte des hauteurs', async () => {
      let photo: Uint8Array | null = null
      for (let i = 0; i < 3 && !photo; i++) {
        const r = await fetch(urlOrtho(cadre.bbox, cadre.largeur, cadre.hauteur, resolution <= 10), { signal: AbortSignal.timeout(20000) }).catch(() => null)
        if (r?.ok && (r.headers.get('content-type') ?? '').startsWith('image/')) photo = new Uint8Array(await r.arrayBuffer())
        else {
          await r?.body?.cancel()
          await new Promise((ok) => setTimeout(ok, 800 * (i + 1)))
        }
      }
      if (!photo) throw new Error('photo_ign_indisponible')
      return { photo, carte: await carteDesHauteurs(niveaux.nuage, releve, niveaux.niveaux, cadre) }
    })

    // 4. L'IA lit la scène.
    const lecture = await etape(cleabs, suivi, 'scene', 'L’IA lit la scène', async () => {
      const client = new Anthropic({ apiKey: cle })
      const requete = {
        model: modeleVision(),
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { format: { type: 'json_schema', schema: SCHEMA_SCENE } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64(images.photo) } },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64(images.carte) } },
              { type: 'text', text: consigneScene(releve, niveaux.niveaux, null, resolution) },
            ],
          },
        ],
      }
      let reponse: Anthropic.Beta.BetaMessage
      try {
        reponse = await client.beta.messages.create(requete as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw new Error('vision_occupee')
        if (e instanceof Anthropic.APIError) throw new Error(`vision_en_panne_${e.status}`)
        throw e
      }
      if (reponse.stop_reason === 'refusal') throw new Error('vision_refus')
      const texte = reponse.content.find((b) => b.type === 'text')
      if (!texte || texte.type !== 'text') throw new Error('vision_vide')
      let scene: SceneIA
      try {
        scene = JSON.parse(texte.text) as SceneIA
      } catch {
        throw new Error('vision_illisible')
      }
      return { scene, modele: reponse.model, usage: reponse.usage }
    })

    // 4 bis. L'IA TRACE la maison sur la photo, le laser mesure dans ses tracés.
    const tracage = await etape(cleabs, suivi, 'traces', 'L’IA trace la maison', async () => {
      const client = new Anthropic({ apiKey: cle })
      const ortho = await chargerOrtho(cadre, resolution <= 10)
      const relief = reliefDe(niveaux.nuage, cadre)
      // Le fond du tracé : le relief du laser, dans le repère exact des points. La photo n'est qu'une vue de plus.
      const laser = imageLaser(relief, ortho.largeur, ortho.hauteur)
      const cache = new Map<Vue, Uint8Array>()
      const vue = async (v: Vue | 'hauteurs'): Promise<Uint8Array | null> => {
        if (v === 'hauteurs') return images.carte
        const connue = cache.get(v)
        if (connue) return connue
        const png = v === 'dessus' ? await vueDessus(laser) : v === 'photo' ? await vueDessus(ortho) : await vueOblique(relief, ortho, v)
        cache.set(v, png)
        return png
      }
      return await metreur({
        ctx: { nuage: niveaux.nuage, cadre, relief },
        ortho: laser,
        image: (v) => vue(v),
        creer: async (p) => {
          try {
            return (await client.messages.create({
              model: modeleVision(),
              max_tokens: 6000,
              system: p.system,
              tools: p.tools as unknown as Anthropic.Tool[],
              messages: p.messages as unknown as Anthropic.MessageParam[],
            })) as unknown as Reponse
          } catch (e) {
            if (e instanceof Anthropic.RateLimitError) throw new Error('vision_occupee')
            if (e instanceof Anthropic.APIError) throw new Error(`vision_en_panne_${e.status}`)
            throw e
          }
        },
        // Le programme propose ses pans, ses terrasses et son contour : l'IA les corrige, elle ne repart pas de zéro.
        depart: tracesDepuisReleve(releve, cadre),
        maxTours: 10,
        apresTour: async ({ traces }) => {
          await ecrire(cleabs, { traces })
        },
      })
    })

    // 4 ter. Les mesures tirées des tracés : le relevé refait avec les pans de l'IA. Il n'est retenu
    // que s'il explique les points du laser au moins aussi bien que le relevé automatique.
    const retenu = await etape(cleabs, suivi, 'releve_ia', 'Mesures tirées des tracés', async () => {
      const entree = await entreeGardee(cleabs)
      const imposes = tracage.traces
        .filter((t) => t.genre === 'pan' || t.genre === 'terrasse')
        .map((t) => ({ polygone: enLambert(t, cadre), terrasse: t.genre === 'terrasse' }))
      if (!entree || !imposes.some((p) => !p.terrasse)) return { choix: 'auto' as const, motif: 'aucun pan tracé' }
      const emprise = tracage.traces.find((t) => t.genre === 'emprise')
      const faite = releverBatiment({
        nuage: niveaux.nuage,
        zone: entree.zone,
        contour: emprise ? enLambert(emprise, cadre).map(([x, y]) => depuisLambert93(x, y)) : releve.murs,
        voisins: entree.voisins.map((v) => v.contour),
        routes: entree.routes,
        vol: releve.vol,
        imposes,
      })
      const qIA = faite.qualitePlans ?? 0, qAuto = releve.qualitePlans ?? 0
      const bon = releveUtilisable(faite) && qIA >= qAuto - 0.005
      return { choix: bon ? ('ia' as const) : ('auto' as const), faite: { ...faite, ortho5cm: releve.ortho5cm }, qIA, qAuto, motif: bon ? null : `les pans de l'IA expliquent ${Math.round(qIA * 100)} % des points du laser, le relevé automatique ${Math.round(qAuto * 100)} %` }
    })
    if (retenu.choix === 'ia' && retenu.faite) {
      const r = retenu.faite
      // Le relevé gardé pour la maison devient celui-ci : l'écran, le PDF, le dossier de métrés lisent les mêmes chiffres.
      await rpcService('enregistrer_releve', {
        p_cleabs: cleabs,
        p_version: VERSION_RELEVE,
        p_statut: 'fait',
        p_motif: r.motif,
        p_confiance: r.confiance,
        p_releve: r,
        p_toit_vrai: r.surfaces.toitVrai,
        p_toit_plan: r.surfaces.toitPlan,
        p_recalage: Math.round(Math.hypot(r.recalage.dx, r.recalage.dy) * 100) / 100,
        p_vol: r.vol,
        p_octets: null,
        p_duree_ms: null,
        p_extrait: true,
      }).catch((e) => console.error('metre-ia: relevé IA non gardé', e))
    }
    const noteReleve =
      retenu.choix === 'ia'
        ? `Pans corrigés par l'IA retenus : ils expliquent ${Math.round((retenu.qIA ?? 0) * 100)} % des points du laser (relevé automatique : ${Math.round((retenu.qAuto ?? 0) * 100)} %).`
        : `Pans automatiques conservés : ${retenu.motif}.`

    // 5. Le contrôle des mesures.
    const { scene, verif } = await etape(cleabs, suivi, 'controle', 'Contrôle par les mesures', async () => validerScene(lecture.scene, releve, niveaux.niveaux))

    // 6. Les façades, une photo de rue par mur.
    const facades = await etape(cleabs, suivi, 'facades', 'Fenêtres et portes des façades', () => lireFacades(cleabs, releve, appelant))
    if (facades.sans_photo.length) verif.a_verifier.push(`Pas de photo de rue pour la façade ${facades.sans_photo.join(', ')} : fenêtres non lues.`)
    for (const e of facades.erreurs) verif.a_verifier.push(`Façade non lue — ${e}.`)

    // La grille d'étiquettes (volumineuse) ne se garde pas : elle ne sert qu'à dessiner la carte.
    const sansGrille = { niveaux: niveaux.niveaux.niveaux, transitions: niveaux.niveaux.transitions, auPied: niveaux.niveaux.auPied }
    await ecrire(cleabs, {
      statut: 'fait',
      etape: null,
      etapes: suivi.etapes,
      scene,
      traces: tracage.traces,
      mesures: tracage.mesures,
      niveaux: sansGrille,
      releve: retenu.choix === 'ia' ? retenu.faite : null,
      verif: { ...verif, a_verifier: [...verif.a_verifier, ...tracage.doutes, ...tracage.alertes], releve_ia: noteReleve },
      modele: lecture.modele,
      cout: {
        entree: lecture.usage.input_tokens + tracage.usage.entree,
        sortie: lecture.usage.output_tokens + tracage.usage.sortie,
        tours_traces: tracage.tours,
        entree_traces: tracage.usage.entree,
        sortie_traces: tracage.usage.sortie,
        resume_traces: tracage.resume,
        pans_de: retenu.choix,
        qualite_ia: retenu.qIA ?? null,
        qualite_auto: retenu.qAuto ?? null,
        duree_ms: Math.round(performance.now() - suivi.t0),
        facades_lues: facades.lues,
      },
      motif: null,
      fait_le: new Date().toISOString(),
    })
  } catch (e) {
    console.error('metre-ia', cleabs, e)
    await ecrire(cleabs, {
      statut: 'echec',
      etape: null,
      etapes: suivi.etapes,
      motif: String(e instanceof Error ? e.message : e).slice(0, 200),
      fait_le: new Date().toISOString(),
    }).catch(() => undefined)
  }
}
