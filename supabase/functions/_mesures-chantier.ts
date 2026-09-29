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
import { facadeRetenue, lignesRetenues, orientationsDesFacades, pansParDefaut, toitRetenu } from './_releve-retenu.ts'
import { lectureParPans, mesureFacade, penteMesureeDe, type Toiture } from './_toiture.ts'
import { photoDeLaFacade, resultatRetenu, type PhotoLue } from './_ouvertures.ts'
import type { MateriauxGardes } from './_materiaux.ts'

/** Le débord que l'écran applique par défaut (panneau-batiment.tsx). */
export const DEBORD_DEFAUT_M = 0.4

export interface QuantiteMesuree {
  cle: string
  unite: 'm2' | 'ml' | 'm' | 'pct' | 'u'
  valeur: number
  source: 'lidar' | 'photogrammetrie' | 'parcelle' | 'ia_photo'
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
  // Les pans que l'écran compte d'office : sans les terrasses.
  const retenus = pansParDefaut(r)
  const toit = toitRetenu(r, retenus)
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
      detail: { ...detail, pans: toit.nb, debord_min_m: r.debord.min, debord_max_m: r.debord.max, plan_m2: toit.plan },
    },
    { cle: 'toit_pente', unite: 'pct', valeur: toit.pente, source: 'lidar', detail },
    { cle: 'toit_pans', unite: 'u', valeur: toit.nb, source: 'lidar', detail },
  ]
  // Les linéaires du couvreur : faîtage, arêtiers, noues, égouts, rives.
  const { totaux } = lignesRetenues(r, retenus)
  for (const [cle, type] of [
    ['faitage', 'faitage'],
    ['aretiers', 'aretier'],
    ['noues', 'noue'],
    ['egouts', 'egout'],
    ['rives', 'rive'],
  ] as const) {
    sortie.push({
      cle,
      unite: 'ml',
      valeur: Math.round(totaux[type].longueur * 10) / 10,
      source: 'lidar',
      detail: { ...detail, nombre: totaux[type].nombre },
    })
  }
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

/**
 * Les ouvertures des façades, lues sur leurs photos : leur nombre, leur
 * surface, et la façade NETTE (brute moins ouvertures) — celle-ci seulement si
 * CHAQUE façade à traiter a sa lecture : une seule façade sans photo, et le
 * total net serait faux sans le dire.
 */
export function quantitesDesOuvertures(r: Releve, photos: PhotoLue[]): QuantiteMesuree[] {
  const lues: { orientation: string; nombre: number; surface: number; methode: string | null; source: string }[] = []
  const aTraiter = orientationsDesFacades(r).filter((o) => facadeRetenue(r, o).surface > 0)
  for (const o of aTraiter) {
    const p = photoDeLaFacade(photos, o)
    const res = p && resultatRetenu(p)
    if (!p || !res?.utilisable || res.surface == null) continue
    lues.push({ orientation: o, nombre: res.nombre, surface: res.surface, methode: res.methode, source: p.source })
  }
  if (!lues.length) return []
  const detail = {
    methode: 'photo_facade',
    facades: lues.map((l) => ({ orientation: l.orientation, nombre: l.nombre, surface_m2: l.surface, methode: l.methode, photo: l.source })),
    sans_photo: aTraiter.filter((o) => !lues.some((l) => l.orientation === o)),
  }
  const surface = Math.round(lues.reduce((s, l) => s + l.surface, 0) * 10) / 10
  const sortie: QuantiteMesuree[] = [
    { cle: 'ouvertures', unite: 'u', valeur: lues.reduce((s, l) => s + l.nombre, 0), source: 'ia_photo', detail },
    { cle: 'ouvertures_surface', unite: 'm2', valeur: surface, source: 'ia_photo', detail },
  ]
  if (lues.length === aTraiter.length) {
    const brute = aTraiter.reduce((s, o) => s + facadeRetenue(r, o).surface, 0)
    sortie.push({
      cle: 'facade_nette',
      unite: 'm2',
      valeur: Math.round(Math.max(0, brute - surface) * 100) / 100,
      source: 'lidar',
      detail: { ...detail, brute_m2: Math.round(brute * 100) / 100 },
    })
  }
  return sortie
}

/** Les fenêtres de toit et les cheminées, comptées sur la photo aérienne à 5 cm seulement. */
export function quantitesDuToitLu(m: MateriauxGardes | null): QuantiteMesuree[] {
  const t = m?.toit
  if (!t?.meme_batiment) return []
  const detail = { methode: 'ortho_ia', resolution_cm: m!.resolution_cm, lu_le: m!.lu_le }
  const sortie: QuantiteMesuree[] = []
  if (t.fenetres_toit != null) sortie.push({ cle: 'fenetres_toit', unite: 'u', valeur: t.fenetres_toit, source: 'ia_photo', detail })
  if (t.cheminees != null) sortie.push({ cle: 'cheminees', unite: 'u', valeur: t.cheminees, source: 'ia_photo', detail })
  return sortie
}
