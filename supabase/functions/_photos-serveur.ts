// Les photos de rue d'une maison, cherchées et gardées : pour la fonction
// des photos (à l'ouverture de l'onglet Façades) et pour la pré-mesure (avant
// que l'artisan n'ouvre sa fiche). Réservé aux fonctions : clé de service.

import { depuisLambert93, versLambert93 } from './_calcul-toit.ts'
import type { Point } from './_geometrie.ts'
import { photosMapillary, photosPanoramax, type PhotoRue } from './_photos-rue.ts'
import type { Releve } from './_releve.ts'
import { releveUtilisable } from './_releve-retenu.ts'
import { vuesDesFacades } from './_vue-facade.ts'

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

/**
 * Chercher les photos de rue d'une maison et garder, pour chaque façade, la
 * meilleure vue (de face, sans bâtiment devant) : copiée dans notre stockage
 * avec son auteur et sa licence. Rend le nombre de photos gardées.
 */
export async function chercherPhotosRue(cleabs: string): Promise<number> {
  const [l] = await rest<{ releve: Releve; version: number }[]>(
    `releve_batiment?cleabs=eq.${encodeURIComponent(cleabs)}&statut=eq.fait&select=releve,version`,
  )
  if (!l || !releveUtilisable(l.releve)) return 0
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
  let n = 0
  for (const [orientation, [v]] of Object.entries(vues)) {
    if (!v) continue
    const chemin = `${cleabs}/${v.photo.source}-${v.photo.id}.jpg`
    try {
      await copier(v.photo.url, chemin)
    } catch (e) {
      console.error('photos: copie', v.photo.url, e)
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
    n++
  }
  return n
}

/** La maison a-t-elle déjà ses photos de rue (ou la recherche les a-t-elle toutes écartées) ? */
export async function aDesPhotosDeRue(cleabs: string): Promise<boolean> {
  const l = await rest<{ id: string }[]>(
    `facade_photo?cleabs=eq.${encodeURIComponent(cleabs)}&source=neq.artisan&select=id&limit=1`,
  )
  return l.length > 0
}
