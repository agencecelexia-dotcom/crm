// Lire le matériau du toit d'une maison sur la photo aérienne de l'IGN, et
// le garder avec son relevé. Réservé aux fonctions (clé de service) : la
// fonction des photos (à la demande de l'artisan) et la pré-mesure (sous son
// interrupteur « auto_materiaux »).

import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0'
import { cadreDuToit, consigneToit, SCHEMA_TOIT, urlOrtho, type LectureToit, type MateriauxGardes } from './_materiaux.ts'
import { modeleVision } from './_modeles.ts'
import type { Releve } from './_releve.ts'
import { releveUtilisable } from './_releve-retenu.ts'


const URL_BASE = () => Deno.env.get('SUPABASE_URL')!
const CLE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function rest<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${URL_BASE()}/rest/v1/${chemin}`, {
    ...init,
    headers: { apikey: CLE(), authorization: `Bearer ${CLE()}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  })
  if (!r.ok) throw new Error(`rest ${r.status} ${(await r.text()).slice(0, 200)}`)
  return (r.status === 204 ? null : await r.json()) as T
}

/** `lue` : la lecture vient d'être faite (et payée) ; faux si elle était gardée. */
export type IssueToit = { ok: true; materiaux: MateriauxGardes; lue: boolean } | { ok: false; error: string }

/** Le matériau du toit : lu sur la photo aérienne, une fois par maison. */
export async function lireToit(cleabs: string, artisan: string | null): Promise<IssueToit> {
  const [l] = await rest<{ releve: Releve; materiaux: MateriauxGardes | null }[]>(
    `releve_batiment?cleabs=eq.${encodeURIComponent(cleabs)}&statut=eq.fait&select=releve,materiaux`,
  )
  if (!l || !releveUtilisable(l.releve)) return { ok: false, error: 'releve_absent' }
  if (l.materiaux?.toit) return { ok: true, materiaux: l.materiaux, lue: false }
  const cle = Deno.env.get('ANTHROPIC_API_KEY')
  if (!cle) return { ok: false, error: 'vision_indisponible' }
  const tresFine = l.releve.ortho5cm === true
  const resolution_cm = tresFine ? 5 : 20
  const cadre = cadreDuToit(l.releve, resolution_cm)
  // Le service de l'IGN répond parfois « couche inconnue » : on réessaie.
  let image: Uint8Array | null = null
  for (let i = 0; i < 3 && !image; i++) {
    const r = await fetch(urlOrtho(cadre.bbox, cadre.largeur, cadre.hauteur, tresFine), { signal: AbortSignal.timeout(20000) }).catch(() => null)
    if (r?.ok && (r.headers.get('content-type') ?? '').startsWith('image/')) image = new Uint8Array(await r.arrayBuffer())
    else {
      await r?.body?.cancel()
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)))
    }
  }
  if (!image) return { ok: false, error: 'photo_ign_indisponible' }
  let b = ''
  for (let i = 0; i < image.length; i += 0x8000) b += String.fromCharCode(...image.subarray(i, i + 0x8000))

  const client = new Anthropic({ apiKey: cle })
  const requete = {
    model: modeleVision(),
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: { type: 'json_schema', schema: SCHEMA_TOIT } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: btoa(b) } },
          { type: 'text', text: consigneToit(l.releve, cadre.contour, resolution_cm) },
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
      console.error('facade-photo: toit', e.status, e.message)
      return { ok: false, error: 'vision_en_panne' }
    }
    throw e
  }
  if (reponse.stop_reason === 'refusal') return { ok: false, error: 'vision_refus' }
  const texte = reponse.content.find((x) => x.type === 'text')
  if (!texte || texte.type !== 'text') return { ok: false, error: 'vision_vide' }
  let toit: LectureToit
  try {
    toit = JSON.parse(texte.text) as LectureToit
  } catch {
    return { ok: false, error: 'vision_illisible' }
  }
  // À 20 cm, on ne compte ni fenêtres de toit ni cheminées, même si la vision s'y risque.
  if (!tresFine) toit = { ...toit, fenetres_toit: null, cheminees: null }
  const materiaux: MateriauxGardes = { toit, resolution_cm, lu_le: new Date().toISOString(), lu_par: artisan, modele: reponse.model }
  await rest(`releve_batiment?cleabs=eq.${encodeURIComponent(cleabs)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ materiaux, materiaux_le: materiaux.lu_le }),
  })
  return { ok: true, materiaux, lue: true }
}
