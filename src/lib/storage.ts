import { supabase } from '@/lib/supabase/client'

// ------------------------------------------------------------
//  Helpers Supabase Storage — bucket privé "documents".
//  On stocke le CHEMIN du fichier en base ; l'accès se fait via URL signée.
// ------------------------------------------------------------

const BUCKET = 'documents'
const BUCKET_PHOTOS = 'projet-photos'

/** Téléverse une photo de chantier (bucket public) et renvoie son URL publique. */
export async function uploaderPhoto(projetId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  // Chemin imprévisible (anti-énumération) malgré le bucket public.
  const rand = Math.random().toString(36).slice(2)
  const chemin = `${projetId}/${Date.now()}-${rand}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET_PHOTOS)
    .upload(chemin, file, { contentType: file.type || 'image/jpeg' })
  if (error) throw error
  return supabase.storage.from(BUCKET_PHOTOS).getPublicUrl(chemin).data.publicUrl
}

/** Supprime une photo à partir de son URL publique. */
export async function supprimerPhoto(url: string): Promise<void> {
  const marqueur = `/${BUCKET_PHOTOS}/`
  const i = url.indexOf(marqueur)
  if (i === -1) return
  const chemin = url.slice(i + marqueur.length)
  await supabase.storage.from(BUCKET_PHOTOS).remove([chemin])
}

const BUCKET_DEVIS = 'devis'

/**
 * Téléverse un devis (PDF) dans le bucket dédié et renvoie son URL.
 * Chemin imprévisible préfixé par le token d'affectation → isolation par artisan.
 */
export async function uploaderDevis(
  token: string,
  slot: 'devis' | 'devis_signe',
  file: File,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
  const rand = Math.random().toString(36).slice(2)
  const chemin = `${token}/${slot}-${rand}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET_DEVIS)
    .upload(chemin, file, { contentType: file.type || 'application/pdf' })
  if (error) throw error
  return supabase.storage.from(BUCKET_DEVIS).getPublicUrl(chemin).data.publicUrl
}

/** Téléverse un devis GÉNÉRÉ (PDF blob) dans le bucket public `devis` et renvoie son URL. */
export async function uploaderDevisGenere(
  token: string,
  numero: string,
  blob: Blob,
): Promise<string> {
  const rand = Math.random().toString(36).slice(2)
  const chemin = `${token}/genere-${numero}-${rand}.pdf`
  const { error } = await supabase.storage
    .from(BUCKET_DEVIS)
    .upload(chemin, blob, { contentType: 'application/pdf' })
  if (error) throw error
  return supabase.storage.from(BUCKET_DEVIS).getPublicUrl(chemin).data.publicUrl
}

/** Types de documents rattachés à un projet. */
export type TypeDocument = 'contrat' | 'devis' | 'devis_signe'

/**
 * Téléverse un fichier dans le bucket privé et renvoie son chemin de stockage.
 * Chemin : <projetId>/<type>-<timestampLisible>.<ext>
 */
export async function uploaderDocument(
  projetId: string,
  type: TypeDocument,
  file: File,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
  // On préfixe par le type pour écraser proprement un re-upload du même type.
  const chemin = `${projetId}/${type}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(chemin, file, {
    upsert: true,
    contentType: file.type || 'application/pdf',
  })
  if (error) throw error
  return chemin
}

/**
 * Génère une URL signée (valable 1h par défaut) pour consulter un document privé.
 * `download` force le téléchargement (Content-Disposition: attachment) ; on peut
 * passer un nom de fichier (string) ou `true` pour garder le nom d'origine.
 * Renvoie null si le chemin est vide.
 */
export async function urlSignee(
  chemin: string | null | undefined,
  expiresInSec = 3600,
  download?: boolean | string,
): Promise<string | null> {
  if (!chemin) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(chemin, expiresInSec, download ? { download } : undefined)
  if (error) return null
  return data.signedUrl
}
