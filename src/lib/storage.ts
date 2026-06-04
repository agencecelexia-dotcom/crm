import { supabase } from '@/lib/supabase/client'

// ------------------------------------------------------------
//  Helpers Supabase Storage — bucket privé "documents".
//  On stocke le CHEMIN du fichier en base ; l'accès se fait via URL signée.
// ------------------------------------------------------------

const BUCKET = 'documents'

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
