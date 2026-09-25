import { formatM, formatM2 } from './geometrie'

/**
 * Les mesures d'une maison, en texte : ce que l'artisan colle dans son devis
 * ou envoie à son équipe. Chaque chiffre y garde sa provenance — « mesuré au
 * LiDAR », « saisi » — pour qu'on sache, en le relisant, lequel vérifier sur
 * place.
 */
export interface ResumeMetre {
  titre: string | null
  adresse: string | null
  toit: {
    surface: number
    pente: number
    /** « deux pans à 36 % », quand le toit a été lu pan par pan. */
    pans: string | null
    debordCm: number
    source: 'saisie' | 'lidar' | 'photogrammetrie'
    /** Un seul versant retenu, s'il y a lieu. */
    versant: string | null
  } | null
  facades: { orientation: string; surface: number; hauteur: number | null }[]
  emprise: number
  perimetre: number
  dimensions: { longueur: number; largeur: number } | null
}

const SOURCE: Record<'saisie' | 'lidar' | 'photogrammetrie', string> = {
  saisie: 'pente saisie',
  lidar: 'mesuré au LiDAR de l’IGN',
  photogrammetrie: 'mesuré par photogrammétrie de l’IGN',
}

export function texteMetre(r: ResumeMetre): string {
  const lignes: string[] = []
  lignes.push(['Métré', r.titre].filter(Boolean).join(' — '))
  if (r.adresse) lignes.push(r.adresse)
  lignes.push('')
  if (r.toit) {
    const t = r.toit
    const detail = [t.pans ?? `pente ${t.pente} %`, t.debordCm ? `débord ${t.debordCm} cm` : null]
      .filter(Boolean)
      .join(', ')
    lignes.push(`Toit${t.versant ? ` (versant ${t.versant})` : ''} : ${formatM2(t.surface)} — ${detail} — ${SOURCE[t.source]}`)
    lignes.push(
      `  À commander : ${[5, 10, 15].map((c) => `${formatM2(t.surface * (1 + c / 100))} (+${c} %)`).join(' · ')}`,
    )
  }
  for (const f of r.facades) {
    lignes.push(
      `Façade ${f.orientation} : ${formatM2(f.surface)}${f.hauteur ? ` — hauteur ${formatM(f.hauteur)}` : ''} — ouvertures non déduites`,
    )
  }
  lignes.push(`Au sol : ${formatM2(r.emprise)} · périmètre ${formatM(r.perimetre)}`)
  if (r.dimensions) lignes.push(`Dimensions : ${formatM(r.dimensions.longueur)} × ${formatM(r.dimensions.largeur)}`)
  lignes.push('')
  lignes.push('Mesures relevées à distance (photo aérienne et altitudes de l’IGN) : à confirmer sur place.')
  return lignes.join('\n')
}

/** Partager si le téléphone sait le faire, sinon copier. Rend ce qui a été fait. */
export async function partagerTexte(titre: string, texte: string): Promise<'partage' | 'copie' | 'echec'> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title: titre, text: texte })
      return 'partage'
    }
  } catch (e) {
    // L'artisan a refermé la feuille de partage : rien à signaler.
    if (e instanceof DOMException && e.name === 'AbortError') return 'echec'
  }
  try {
    await navigator.clipboard.writeText(texte)
    return 'copie'
  } catch {
    return 'echec'
  }
}
