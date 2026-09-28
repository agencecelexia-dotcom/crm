// Ce que l'artisan retient d'un relevé : les pans du toit qu'il couvre, la
// façade qu'il ravale. Les mêmes additions qu'en base (migration 0178) :
// l'écran affiche ce que `enregistrer_metre_by_token` gardera.
//
// Module léger : l'écran l'importe sans embarquer le calcul du relevé.

import type { FacadeReleve, Releve } from './_releve.ts'

export type { BordReleve, FacadeReleve, PanReleve, Releve } from './_releve.ts'

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Le relevé remplace-t-il la grille d'altitudes ? Pas s'il n'a trouvé aucun
 * toit sous le contour, ni si le contour n'a pas pu être posé sur le toit :
 * des chiffres justes sur un autre toit seraient pires que ceux d'avant.
 */
export function releveUtilisable(r: Releve | null | undefined): r is Releve {
  return !!r && !r.motif && r.confiance !== 'basse' && r.pans.length > 0
}

/** La toiture retenue : la somme des pans choisis, tous si `pans` est nul. */
export function toitRetenu(
  r: Releve,
  pans: number[] | null,
): { plan: number; vrai: number; pente: number; nb: number } {
  const gardes = r.pans.filter((p) => !pans || pans.includes(p.id))
  const plan = gardes.reduce((s, p) => s + p.airePlan, 0)
  const vrai = gardes.reduce((s, p) => s + p.aireVraie, 0)
  // La pente qui, sur la surface retenue, donne la même surface vraie.
  const pente = vrai > 0 && plan > 0 ? Math.round(1000 * Math.tan(Math.acos(Math.min(1, plan / vrai)))) / 10 : 0
  return { plan: r2(plan), vrai: r2(vrai), pente, nb: gardes.length }
}

/**
 * Une façade : les murs relevés d'une orientation. La partie mitoyenne ne se
 * traite pas : elle est hors de la surface, et dite à part.
 */
export function facadeRetenue(
  r: Releve,
  orientation: string,
): { murs: FacadeReleve[]; surface: number; longueur: number; hauteur: number | null; accole: number } {
  const murs = r.facades.filter((f) => f.orientation === orientation)
  const surface = murs.reduce((s, f) => s + f.surfaceLibre, 0)
  const longueur = murs.reduce((s, f) => s + Math.max(0, f.longueur - f.accole), 0)
  return {
    murs,
    surface: r2(surface),
    longueur: r2(longueur),
    hauteur: longueur > 0 ? r2(surface / longueur) : null,
    accole: r2(murs.reduce((s, f) => s + f.accole, 0)),
  }
}

/** Les orientations des façades, dans l'ordre du tour de la maison, sans doublon. */
export function orientationsDesFacades(r: Releve): string[] {
  return [...new Set(r.facades.map((f) => f.orientation))]
}
