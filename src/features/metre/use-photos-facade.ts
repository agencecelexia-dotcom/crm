import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { MateriauxGardes } from './materiaux'
import type { LectureGardee } from './ouvertures'

export type { LectureGardee }

/** Une photo de façade gardée : de rue (Panoramax, Mapillary) ou prise par l'artisan. */
export interface PhotoFacade {
  id: string
  orientation: string
  source: 'panoramax' | 'mapillary' | 'artisan'
  auteur: string | null
  licence: string | null
  page: string | null
  pris_le: string | null
  largeur: number | null
  hauteur: number | null
  distance_m: number | null
  incidence: number | null
  colonnes: number[] | null
  lecture: LectureGardee | null
  /** Les rangs des ouvertures lues que l'artisan a retirées. */
  ecartees: number[]
  /** Lien signé, valable une heure. */
  url: string | null
}

async function appeler<T>(corps: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('facade-photo', { body: corps })
  if (error) throw error
  const r = data as { ok?: boolean; error?: string }
  if (!r?.ok) throw new Error(r?.error ?? 'echec')
  return data as T
}

/** La requête des photos d'une maison : pour le crochet, et pour le rapport qui la lit d'un appui. */
export const requetePhotosFacade = (token: string | undefined, cleabs: string | null) => ({
  queryKey: ['photos-facade', cleabs],
  // Les liens d'image sont signés pour une heure.
  staleTime: 1000 * 60 * 30,
  queryFn: async () => (await appeler<{ photos: PhotoFacade[] }>({ token, action: 'chercher', cleabs })).photos,
})

/** Les photos des façades d'une maison : cherchées dans la rue au premier appel, puis gardées. */
export function usePhotosFacade(token: string | undefined, cleabs: string | null, actif: boolean) {
  return useQuery({ ...requetePhotosFacade(token, cleabs), enabled: !!token && !!cleabs && actif, retry: 1 })
}

/** Faire lire une photo par la vision : ouvertures, surface, hauteur de contrôle. */
export function useLirePhoto(token: string | undefined, cleabs: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      (await appeler<{ lecture: LectureGardee }>({ token, action: 'lire', id })).lecture,
    onSuccess: (lecture, id) =>
      qc.setQueryData<PhotoFacade[]>(['photos-facade', cleabs], (avant) =>
        avant?.map((p) => (p.id === id ? { ...p, lecture } : p)),
      ),
  })
}

/** Retirer une ouverture lue (un reflet, une grille), ou la remettre. */
export function useEcarterOuverture(token: string | undefined, cleabs: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, rang, ecartee }: { id: string; rang: number; ecartee: boolean }) =>
      ({ id, ecartees: (await appeler<{ ecartees: number[] }>({ token, action: 'ecarter', id, rang, ecartee })).ecartees }),
    onSuccess: ({ id, ecartees }) =>
      qc.setQueryData<PhotoFacade[]>(['photos-facade', cleabs], (avant) =>
        avant?.map((p) => (p.id === id ? { ...p, ecartees } : p)),
      ),
  })
}

/** Le matériau du toit gardé pour cette maison (lu par la pré-mesure ou un artisan) ; null s'il n'a pas été lu. */
export const requeteMateriauxToit = (token: string | undefined, cleabs: string | null) => ({
  queryKey: ['materiaux-toit', cleabs],
  staleTime: 1000 * 60 * 60,
  queryFn: async () =>
    (await appeler<{ materiaux: MateriauxGardes | null }>({ token, action: 'materiau_toit', cleabs })).materiaux,
})

export function useMateriauxToit(token: string | undefined, cleabs: string | null, actif: boolean) {
  return useQuery({ ...requeteMateriauxToit(token, cleabs), enabled: !!token && !!cleabs && actif, retry: 1 })
}

/** Faire lire le matériau du toit sur la photo aérienne (une lecture par maison). */
export function useLireToit(token: string | undefined, cleabs: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      (await appeler<{ materiaux: MateriauxGardes }>({ token, action: 'materiau_toit', cleabs, lire: true })).materiaux,
    onSuccess: (m) => qc.setQueryData(['materiaux-toit', cleabs], m),
  })
}

/** Réduire une photo de téléphone à 2 048 px de large (moins lourde à envoyer et à lire). */
async function reduire(fichier: File): Promise<{ blob: Blob; largeur: number; hauteur: number }> {
  const image = await createImageBitmap(fichier)
  const k = Math.min(1, 2048 / Math.max(image.width, image.height))
  const largeur = Math.round(image.width * k), hauteur = Math.round(image.height * k)
  const toile = document.createElement('canvas')
  toile.width = largeur
  toile.height = hauteur
  toile.getContext('2d')!.drawImage(image, 0, 0, largeur, hauteur)
  const blob = await new Promise<Blob>((ok, ko) =>
    toile.toBlob((b) => (b ? ok(b) : ko(new Error('image_illisible'))), 'image/jpeg', 0.85),
  )
  return { blob, largeur, hauteur }
}

/** La photo que l'artisan prend de la façade : envoyée, gardée, puis lue. */
export function useDeposerPhoto(token: string | undefined, cleabs: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ fichier, orientation }: { fichier: File; orientation: string }) => {
      const { blob, largeur, hauteur } = await reduire(fichier)
      const { chemin, jeton } = await appeler<{ chemin: string; jeton: string }>({ token, action: 'deposer', cleabs, orientation })
      const { error } = await supabase.storage.from('facades').uploadToSignedUrl(chemin, jeton, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      const { photo } = await appeler<{ photo: PhotoFacade }>({ token, action: 'enregistrer', cleabs, orientation, chemin, largeur, hauteur })
      const lecture = (await appeler<{ lecture: LectureGardee }>({ token, action: 'lire', id: photo.id })).lecture
      return { ...photo, lecture }
    },
    onSuccess: (photo) =>
      qc.setQueryData<PhotoFacade[]>(['photos-facade', cleabs], (avant) => [photo, ...(avant ?? [])]),
  })
}

/** Ce que l'écran dit d'une erreur de la fonction. */
export const MESSAGES_PHOTO: Record<string, string> = {
  quota_atteint: 'Vingt photos lues aujourd’hui : la suite demain.',
  vision_occupee: 'La lecture est très demandée en ce moment : réessayez dans une minute.',
  vision_en_panne: 'La lecture de la photo a échoué : réessayez.',
  vision_refus: 'Cette photo n’a pas pu être lue.',
  releve_absent: 'Le relevé de la maison n’est pas encore prêt.',
  facade_introuvable: 'Cette façade n’a rien à traiter (mur mitoyen).',
  photo_ign_indisponible: 'La photo aérienne de l’IGN ne répond pas : réessayez dans un moment.',
}
