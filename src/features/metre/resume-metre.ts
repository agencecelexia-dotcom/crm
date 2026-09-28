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
    source: 'saisie' | 'lidar' | 'photogrammetrie' | 'releve'
    /** Un seul versant retenu, s'il y a lieu. */
    versant: string | null
    /** Le débord MESURÉ, en clair (« 34 à 72 cm selon les côtés ») : il remplace `debordCm`. */
    debord?: string | null
    /** Le vol LiDAR du relevé, « septembre 2021 ». */
    vol?: string | null
  } | null
  facades: { orientation: string; surface: number; hauteur: number | null; rue?: boolean }[]
  emprise: number
  perimetre: number
  dimensions: { longueur: number; largeur: number } | null
}

const SOURCE: Record<'saisie' | 'lidar' | 'photogrammetrie' | 'releve', string> = {
  saisie: 'pente saisie',
  lidar: 'mesuré au LiDAR de l’IGN',
  photogrammetrie: 'mesuré par photogrammétrie de l’IGN',
  releve: 'mesuré dans les points LiDAR de l’IGN, pan par pan',
}

export function texteMetre(r: ResumeMetre): string {
  const lignes: string[] = []
  lignes.push(['Métré', r.titre].filter(Boolean).join(' — '))
  if (r.adresse) lignes.push(r.adresse)
  lignes.push('')
  if (r.toit) {
    const t = r.toit
    const debord = t.debord ? `débord ${t.debord}` : t.debordCm ? `débord ${t.debordCm} cm` : null
    const detail = [t.pans ?? `pente ${t.pente} %`, debord].filter(Boolean).join(', ')
    const source = SOURCE[t.source] + (t.vol ? ` (vol de ${t.vol})` : '')
    lignes.push(`Toit${t.versant ? ` (versant ${t.versant})` : ''} : ${formatM2(t.surface)} — ${detail} — ${source}`)
    lignes.push(
      `  À commander : ${[5, 10, 15].map((c) => `${formatM2(t.surface * (1 + c / 100))} (+${c} %)`).join(' · ')}`,
    )
  }
  for (const f of r.facades) {
    lignes.push(
      `Façade ${f.orientation}${f.rue ? ' (côté rue)' : ''} : ${formatM2(f.surface)}${f.hauteur ? ` — hauteur ${formatM(f.hauteur)}` : ''} — ouvertures non déduites`,
    )
  }
  lignes.push(`Au sol : ${formatM2(r.emprise)} · périmètre ${formatM(r.perimetre)}`)
  if (r.dimensions) lignes.push(`Dimensions : ${formatM(r.dimensions.longueur)} × ${formatM(r.dimensions.largeur)}`)
  lignes.push('')
  lignes.push('Mesures relevées à distance (données de l’IGN) : à confirmer sur place.')
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
