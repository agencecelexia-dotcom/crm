// Ce que l'artisan retient d'un relevé : les pans du toit qu'il couvre, la
// façade qu'il ravale. Les mêmes additions qu'en base (migration 0178) :
// l'écran affiche ce que `enregistrer_metre_by_token` gardera.
//
// Module léger : l'écran l'importe sans embarquer le calcul du relevé.

import type { FacadeReleve, LigneReleve, Releve, TypeLigne } from './_releve.ts'

export type { BordReleve, FacadeReleve, LigneReleve, PanReleve, Releve, TypeLigne } from './_releve.ts'

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Le relevé remplace-t-il la grille d'altitudes ? Pas s'il n'a trouvé aucun
 * toit sous le contour, ni si le contour n'a pas pu être posé sur le toit :
 * des chiffres justes sur un autre toit seraient pires que ceux d'avant.
 */
export function releveUtilisable(r: Releve | null | undefined): r is Releve {
  return !!r && !r.motif && r.confiance !== 'basse' && r.pans.length > 0
}

/**
 * Les pans comptés d'office : tous, sauf les terrasses quand il y a aussi des
 * pans en pente. Nul quand c'est tout le toit.
 */
export function pansParDefaut(r: Releve): number[] | null {
  const terrasses = r.pans.filter((p) => p.terrasse)
  if (!terrasses.length || terrasses.length === r.pans.length) return null
  return r.pans.filter((p) => !p.terrasse).map((p) => p.id)
}

/**
 * La toiture retenue : la somme des pans choisis, tous si `pans` est nul.
 *
 * DEUX « PENTES ». `pente` est l'ÉQUIVALENTE : celle qui, sur toute la surface
 * retenue, donne la même surface vraie — la base la recalcule ainsi (0178), ce
 * qui garde « enregistré = affiché ». Elle se dilue dans une partie plate ou un
 * petit pan doux (36,7 % sur deux pans à 48-49 %). `penteDesPans` est celle
 * que lit le couvreur : la MÉDIANE des pans EN PENTE, pondérée par leur surface
 * (un petit pan doux — 20 % à côté de deux pans à 48 % — ne la tire pas) ;
 * `platPlan` dit ce qui est plat, à part.
 */
export function toitRetenu(
  r: Releve,
  pans: number[] | null,
): { plan: number; vrai: number; pente: number; penteDesPans: number; platPlan: number; nb: number } {
  const gardes = r.pans.filter((p) => !pans || pans.includes(p.id))
  const plan = gardes.reduce((s, p) => s + p.airePlan, 0)
  const vrai = gardes.reduce((s, p) => s + p.aireVraie, 0)
  // La pente qui, sur la surface retenue, donne la même surface vraie.
  const pente = vrai > 0 && plan > 0 ? Math.round(1000 * Math.tan(Math.acos(Math.min(1, plan / vrai)))) / 10 : 0
  const pentus = gardes.filter((p) => p.orientation !== 'plat')
  const planPentus = pentus.reduce((s, p) => s + p.airePlan, 0)
  let penteDesPans = 0
  if (planPentus > 0) {
    let cumul = 0
    for (const p of [...pentus].sort((a, b) => a.pente - b.pente)) {
      cumul += p.airePlan
      if (cumul >= planPentus / 2) {
        penteDesPans = Math.round(p.pente * 10) / 10
        break
      }
    }
  }
  const platPlan = gardes.filter((p) => p.orientation === 'plat').reduce((s, p) => s + p.airePlan, 0)
  return { plan: r2(plan), vrai: r2(vrai), pente, penteDesPans, platPlan: r2(platPlan), nb: gardes.length }
}

/**
 * Une façade : les murs relevés d'une orientation. La partie mitoyenne ne se
 * traite pas : elle est hors de la surface, et dite à part.
 *
 * « FAÇADE SUD » DÉSIGNE L'ORIENTATION ENTIÈRE, partout (fiche 3D, tableau,
 * PDF, sur place). Elle peut compter plusieurs murs : un décroché, un mur en
 * retrait au-dessus d'une terrasse. `surface` et `longueur` les additionnent
 * TOUS (la base fait la même somme à l'enregistrement, 0178) ; `retrait` en dit
 * la part déduite de l'égout au-dessus d'une terrasse, pour l'écrire à côté.
 */
export function facadeRetenue(
  r: Releve,
  orientation: string,
): {
  murs: FacadeReleve[]
  surface: number
  longueur: number
  hauteur: number | null
  accole: number
  retrait: { surface: number; longueur: number }
} {
  const murs = r.facades.filter((f) => f.orientation === orientation)
  const surface = murs.reduce((s, f) => s + f.surfaceLibre, 0)
  const longueur = murs.reduce((s, f) => s + Math.max(0, f.longueur - f.accole), 0)
  const retrait = murs.filter((f) => f.retrait)
  return {
    murs,
    surface: r2(surface),
    longueur: r2(longueur),
    hauteur: longueur > 0 ? r2(surface / longueur) : null,
    accole: r2(murs.reduce((s, f) => s + f.accole, 0)),
    retrait: { surface: r2(retrait.reduce((s, f) => s + f.surfaceLibre, 0)), longueur: r2(retrait.reduce((s, f) => s + f.longueur, 0)) },
  }
}

/** Les orientations des façades, dans l'ordre du tour de la maison, sans doublon. */
export function orientationsDesFacades(r: Releve): string[] {
  return [...new Set(r.facades.map((f) => f.orientation))]
}

/** Les linéaires du couvreur, dans l'ordre où il les chiffre. */
export const TYPES_LIGNES: TypeLigne[] = ['faitage', 'aretier', 'noue', 'egout', 'rive']

/**
 * Les lignes des pans retenus : une ligne reste tant qu'un des pans qu'elle
 * borde est gardé (le faîtage d'un toit dont on ne refait qu'un pan reste à
 * traiter). Longueur totale et nombre, par type.
 */
export function lignesRetenues(
  r: Releve,
  pans: number[] | null,
): { lignes: LigneReleve[]; totaux: Record<TypeLigne, { longueur: number; nombre: number }> } {
  const lignes = (r.lignes ?? []).filter((l) => !pans || l.pans.some((p) => pans.includes(p)))
  const totaux = Object.fromEntries(TYPES_LIGNES.map((t) => [t, { longueur: 0, nombre: 0 }])) as Record<
    TypeLigne,
    { longueur: number; nombre: number }
  >
  for (const l of lignes) {
    totaux[l.type].longueur += l.longueur
    totaux[l.type].nombre++
  }
  for (const t of TYPES_LIGNES) totaux[t].longueur = r2(totaux[t].longueur)
  return { lignes, totaux }
}
