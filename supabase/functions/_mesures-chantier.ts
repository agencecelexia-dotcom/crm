// Les quantités d'un chantier, calculées sans écran : ce que la pré-mesure
// écrit au dossier de métrés avant que l'artisan n'ouvre sa fiche.
//
// LE CODE DE L'ÉCRAN, PAS UNE COPIE. La géométrie et les règles du toit
// vivent ici, dans le dossier partagé, et l'écran les réexporte : la valeur
// pré-mesurée est celle que l'artisan lira. Une première version recopiait
// les formules ; sur le toit dissymétrique de Bromines, elle comptait les
// décrochés de moins d'un mètre que l'écran écarte — 201 m² de façades contre
// 198.

import type { ResultatToit } from './_calcul-toit.ts'
import { aire, empriseAvecDebord, facades, longueur, surfaceReelle, type Point } from './_geometrie.ts'
import { lectureParPans, mesureFacade, penteMesureeDe, type Toiture } from './_toiture.ts'

/** Le débord que l'écran applique par défaut (panneau-batiment.tsx). */
export const DEBORD_DEFAUT_M = 0.4

export interface QuantiteMesuree {
  cle: string
  unite: 'm2' | 'ml' | 'm' | 'pct' | 'u'
  valeur: number
  source: 'lidar' | 'photogrammetrie' | 'parcelle'
  detail?: Record<string, unknown>
}

/**
 * Ce que l'outil sait d'une maison sans que personne n'ait rien touché :
 * surface du toit (débord par défaut, pente mesurée), pente, nombre de pans,
 * façades (tous côtés, si chaque façade a son relevé), hauteur à la gouttière.
 */
export function quantitesDeLaMaison(contour: Point[], r: ResultatToit): QuantiteMesuree[] {
  const sortie: QuantiteMesuree[] = []
  if (!r.couvert) return sortie
  const t = r as unknown as Toiture
  const source = r.source.includes('LiDAR') ? 'lidar' : 'photogrammetrie'

  const pente = penteMesureeDe(t)
  if (pente != null) {
    const surface = surfaceReelle(empriseAvecDebord(aire(contour), longueur(contour, true), DEBORD_DEFAUT_M), pente)
    const pans = lectureParPans(t).pans
    sortie.push({
      cle: 'toit_surface',
      unite: 'm2',
      valeur: Math.round(surface * 100) / 100,
      source,
      detail: { debord_m: DEBORD_DEFAUT_M, pente_pct: pente, pans },
    })
    sortie.push({ cle: 'toit_pente', unite: 'pct', valeur: pente, source })
    if (source === 'lidar' && pans.length) sortie.push({ cle: 'toit_pans', unite: 'u', valeur: pans.length, source })
  }

  // Les façades : seulement si CHAQUE façade a son relevé — sinon le total
  // serait faux sans le dire.
  const releves = facades(contour).map((f) => mesureFacade(f, t))
  if (releves.length && releves.every(Boolean)) {
    sortie.push({
      cle: 'facades_total',
      unite: 'm2',
      valeur: Math.round(releves.reduce((s, m) => s + m!.surface, 0) * 100) / 100,
      source,
      detail: { ouvertures: 'non déduites' },
    })
  }
  if (r.hauteur_gouttiere != null) {
    sortie.push({ cle: 'hauteur_murs', unite: 'm', valeur: r.hauteur_gouttiere, source })
  }
  return sortie
}
