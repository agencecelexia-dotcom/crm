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
import type { Releve } from './_releve.ts'
import { facadeRetenue, orientationsDesFacades, toitRetenu } from './_releve-retenu.ts'
import { lectureParPans, mesureFacade, penteMesureeDe, type Toiture } from './_toiture.ts'

/** Le débord que l'écran applique par défaut (panneau-batiment.tsx). */
export const DEBORD_DEFAUT_M = 0.4

export interface QuantiteMesuree {
  cle: string
  unite: 'm2' | 'ml' | 'm' | 'pct' | 'u'
  valeur: number
  source: 'lidar' | 'photogrammetrie' | 'parcelle'
  /** L'incertitude, dans l'unité de la valeur, quand on la connaît. */
  precision?: number | null
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

/**
 * Les mêmes quantités, lues dans le RELEVÉ LiDAR : le toit comme somme des
 * pans (débord mesuré), les façades hors mitoyen, la hauteur à la gouttière.
 * Ce sont les chiffres que l'écran affiche quand le relevé existe.
 */
export function quantitesDuReleve(r: Releve): QuantiteMesuree[] {
  const toit = toitRetenu(r, null)
  // ±5 cm sur tout le bord du toit : la seule incertitude qui compte (affichage-releve.ts).
  const facteur = r.surfaces.toitPlan > 0 ? r.surfaces.toitVrai / r.surfaces.toitPlan : 1
  const precision = Math.round(longueur(r.toit, true) * 0.05 * facteur * 10) / 10
  const detail = {
    methode: 'releve_lidar',
    version: r.version,
    vol: r.vol,
    confiance: r.confiance,
    recalage_m: Math.round(Math.hypot(r.recalage.dx, r.recalage.dy) * 100) / 100,
  }
  const sortie: QuantiteMesuree[] = [
    {
      cle: 'toit_surface',
      unite: 'm2',
      valeur: toit.vrai,
      source: 'lidar',
      precision,
      detail: { ...detail, pans: r.pans.length, debord_min_m: r.debord.min, debord_max_m: r.debord.max, plan_m2: toit.plan },
    },
    { cle: 'toit_pente', unite: 'pct', valeur: toit.pente, source: 'lidar', detail },
    { cle: 'toit_pans', unite: 'u', valeur: r.pans.length, source: 'lidar', detail },
  ]
  const orientations = orientationsDesFacades(r)
  if (orientations.length) {
    const total = orientations.reduce((s, o) => s + facadeRetenue(r, o).surface, 0)
    sortie.push({
      cle: 'facades_total',
      unite: 'm2',
      valeur: Math.round(total * 100) / 100,
      source: 'lidar',
      detail: {
        ...detail,
        ouvertures: 'non déduites',
        mitoyen_m: Math.round(r.facades.reduce((s, f) => s + f.accole, 0) * 10) / 10,
        cote_rue: r.facades.filter((f) => f.rue).map((f) => f.orientation),
      },
    })
  }
  if (r.hauteurs.gouttiere != null) {
    sortie.push({ cle: 'hauteur_murs', unite: 'm', valeur: r.hauteurs.gouttiere, source: 'lidar', detail })
  }
  return sortie
}
