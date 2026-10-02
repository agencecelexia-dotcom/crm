// Le TRI des photos de la rue : pour chaque façade, les meilleures photos (de
// face, proches, récentes) sont lues l'une après l'autre jusqu'à en trouver une
// qui montre vraiment le mur. Les autres — une autre maison, une façade cachée
// par un arbre ou une voiture, une vue de trop loin — sont écartées, et leur
// raison gardée pour être dite. Sans Deno ni réseau : la lecture est injectée.

import { RAISONS_PHOTO } from './_metre-ia-phases.ts'
import type { Releve } from './_releve.ts'

/** Une photo de la rue, telle que `facade-photo` la rend. */
export interface PhotoRue {
  id: string
  orientation: string
  chemin: string
  note: number | null
  lecture: { resultat?: { utilisable?: boolean; motif?: string | null } } | null
}

export interface TriPhotos {
  /** La photo retenue pour chaque façade (la première qui montre vraiment le mur). */
  retenues: Record<string, { id: string; chemin: string }>
  /** Ce qui a été écarté, avec la raison, dite en clair. */
  ecartees: { orientation: string; raison: string }[]
  /** Les façades sans aucune photo, ou sans photo exploitable. */
  sans_photo: string[]
  /** Combien de photos ont été regardées. */
  lues: number
  erreurs: string[]
}

/** Combien de photos on regarde au plus par façade : chaque lecture est payante. */
export const ESSAIS_PAR_FACADE = 3

/** Une lecture de photo : l'IA regarde et rend ce qu'elle voit. `null` : pas de lecture possible (le banc n'a pas de jeton). */
export type LirePhoto = (id: string) => Promise<{ ok: boolean; error?: string; lecture?: PhotoRue['lecture'] }>

export async function trierPhotos(releve: Releve, photos: PhotoRue[], lire: LirePhoto | null): Promise<TriPhotos> {
  const sortie: TriPhotos = { retenues: {}, ecartees: [], sans_photo: [], lues: 0, erreurs: [] }
  const orientations = [...new Set(releve.facades.filter((f) => !f.retrait && f.surfaceLibre > 0).map((f) => f.orientation))]
  for (const o of orientations) {
    const candidates = photos.filter((p) => p.orientation === o).sort((x, y) => (y.note ?? 0) - (x.note ?? 0)).slice(0, ESSAIS_PAR_FACADE)
    if (!candidates.length) {
      sortie.sans_photo.push(o)
      continue
    }
    for (const c of candidates) {
      let lecture = c.lecture
      if (!lecture) {
        if (!lire) continue
        const r = await lire(c.id)
        if (!r.ok) {
          sortie.erreurs.push(`${o} : ${r.error ?? 'échec'}`)
          sortie.ecartees.push({ orientation: o, raison: RAISONS_PHOTO.lecture_impossible })
          continue
        }
        lecture = r.lecture ?? null
      }
      sortie.lues++
      const res = lecture?.resultat
      if (res?.utilisable && res.motif !== 'autre_batiment') {
        sortie.retenues[o] = { id: c.id, chemin: c.chemin }
        break
      }
      sortie.ecartees.push({ orientation: o, raison: RAISONS_PHOTO[res?.motif ?? ''] ?? RAISONS_PHOTO.cadre_invalide })
    }
    if (!sortie.retenues[o] && !sortie.ecartees.some((e) => e.orientation === o)) sortie.sans_photo.push(o)
  }
  return sortie
}
