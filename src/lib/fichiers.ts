// ------------------------------------------------------------
//  Pièces jointes : reconnaissance de format, garde-fous, affichage.
//
//  Les pièces d'un projet ne sont plus limitées au PDF (migration 0098) : un
//  client nous envoie ce qu'il a — le devis d'un concurrent, des photos de la
//  pièce, une vidéo qui montre l'accès au chantier. On accepte donc largement,
//  et on ne refuse que ce qui n'a aucune raison d'être là.
// ------------------------------------------------------------

/** Taille max par fichier. Une vidéo de chantier de 2-3 min filmée au téléphone tient dedans. */
export const TAILLE_MAX_OCTETS = 200 * 1024 * 1024

/**
 * Extensions refusées : exécutables, scripts et raccourcis.
 *
 * Liste noire plutôt que blanche, à dessein. Une liste blanche aurait bloqué
 * le client qui envoie un .heic depuis son iPhone ou un .odt — des cas
 * légitimes qu'on ne peut pas tous prévoir. Ce qu'on veut vraiment empêcher,
 * c'est qu'un binaire exécutable transite par le CRM et finisse téléchargé
 * par un artisan.
 */
const EXTENSIONS_REFUSEES = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'app', 'dmg', 'pkg',
  'deb', 'rpm', 'apk', 'jar', 'dll', 'so', 'lnk', 'reg', 'hta',
])

/** Extension en minuscules, sans le point. Chaîne vide si le nom n'en a pas. */
export function extensionDe(nom: string): string {
  const i = nom.lastIndexOf('.')
  // `i <= 0` couvre « sans extension » et les fichiers cachés type « .env ».
  return i <= 0 ? '' : nom.slice(i + 1).toLowerCase()
}

/** Vrai si le fichier peut être déposé (format autorisé). */
export function formatAutorise(file: File): boolean {
  return !EXTENSIONS_REFUSEES.has(extensionDe(file.name))
}

/** Catégorie d'affichage — pilote l'aperçu (image, lecteur vidéo, icône). */
export type CategorieFichier = 'image' | 'video' | 'audio' | 'pdf' | 'autre'

const EXT_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'svg'])
const EXT_VIDEO = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', '3gp', 'hevc'])
const EXT_AUDIO = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'])

/**
 * Catégorise à partir du type MIME, avec repli sur l'extension.
 *
 * Le repli n'est pas défensif pour rien : les lignes déposées avant 0098 n'ont
 * pas de `type_mime`, et certains navigateurs mobiles renvoient un type vide
 * pour un .heic ou un .mov pris depuis l'appareil photo.
 */
export function categorieDe(nom: string, typeMime?: string | null): CategorieFichier {
  if (typeMime) {
    if (typeMime.startsWith('image/')) return 'image'
    if (typeMime.startsWith('video/')) return 'video'
    if (typeMime.startsWith('audio/')) return 'audio'
    if (typeMime.includes('pdf')) return 'pdf'
  }
  const ext = extensionDe(nom)
  if (EXT_IMAGE.has(ext)) return 'image'
  if (EXT_VIDEO.has(ext)) return 'video'
  if (EXT_AUDIO.has(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  return 'autre'
}

/** Taille lisible : « 340 Ko », « 12,4 Mo ». */
export function formatTaille(octets: number | null | undefined): string {
  if (octets == null) return ''
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  if (octets < 1024 * 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`
  return `${(octets / (1024 * 1024 * 1024)).toFixed(1)} Go`
}
