/**
 * Arithmétique du devis : HT, TVA, TTC, déboursé, marge, commission.
 *
 * Extrait du composant pour être testable : ce sont les chiffres sur lesquels
 * l'artisan décide de son prix, et celui qui porte notre commission.
 */

export interface LigneChiffrable {
  quantite: number
  prix_unitaire: number
  cout_unitaire: number
  tva_taux: number
}

export interface TotauxDevis {
  ht: number
  tva: number
  ttc: number
  cout: number
  marge: number
  margePct: number
  commission: number
}

/**
 * Arrondi commercial au centime, demi vers l'extérieur (1,005 → 1,01).
 *
 * `Math.round(x * 100) / 100` se trompe sur les nombres flottants : 1,005 × 100
 * vaut 100,4999… et donnait 1,00. Le décalage de 1e-7 corrige ce bruit sans
 * jamais changer un vrai montant (il est mille fois plus petit qu'un centime).
 */
export function arrondi(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0
  return (Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7)) / 100
}

export interface LigneVentilable {
  quantite: number
  prix_unitaire: number
  tva_taux?: number | null
}

export interface Ventilation {
  /** Le total de chaque ligne, arrondi au centime — celui qu'on imprime. */
  lignes: number[]
  ht: number
  /** Base et taxe de chaque taux strictement positif, dans l'ordre croissant. */
  parTaux: { taux: number; base: number; tva: number }[]
  tva: number
  ttc: number
}

/**
 * HT, TVA et TTC tels qu'ils s'IMPRIMENT, et s'additionnent.
 *
 * LE DÉFAUT QU'ELLE CORRIGE. Le devis additionnait des montants non arrondis,
 * puis arrondissait chaque total à l'affichage. Sur 5 × 33,33 € à 10 %, le PDF
 * imprimait « HT 166,65 € — TVA 16,67 € — TTC 183,31 € » : un client qui fait
 * l'addition trouve 183,32. En multi-taux, les TVA imprimées ne sommaient pas
 * non plus au TTC. Un devis dont les totaux ne se vérifient pas est contestable.
 *
 * La règle, unique, appliquée par l'écran, le PDF et l'e-mail :
 *   1. chaque ligne est arrondie au centime ;
 *   2. le HT est la somme des lignes arrondies ;
 *   3. la TVA est calculée PAR TAUX, sur la base de ce taux, puis arrondie ;
 *   4. le TTC est le HT plus la somme des TVA arrondies.
 */
export function ventiler(lignes: LigneVentilable[], tvaApplicable: boolean): Ventilation {
  const totaux = lignes.map((l) => arrondi((Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0)))
  const ht = arrondi(totaux.reduce((s, m) => s + m, 0))

  const bases = new Map<number, number>()
  if (tvaApplicable) {
    lignes.forEach((l, i) => {
      const t = Number(l.tva_taux) || 0
      if (t > 0) bases.set(t, (bases.get(t) ?? 0) + totaux[i])
    })
  }
  const parTaux = [...bases.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taux, base]) => ({ taux, base: arrondi(base), tva: arrondi((base * taux) / 100) }))
  const tva = arrondi(parTaux.reduce((s, x) => s + x.tva, 0))

  return { lignes: totaux, ht, parTaux, tva, ttc: arrondi(ht + tva) }
}

/**
 * @param tvaApplicable faux pour la franchise (art. 293 B du CGI) : les taux
 *   saisis sur les lignes sont alors ignorés plutôt qu'effacés, pour qu'un
 *   aller-retour entre les deux régimes ne perde rien.
 * @param tauxCommission part de Celexia sur le TTC (0.15 = 15 %).
 */
export function calculerTotaux(
  lignes: LigneChiffrable[],
  tvaApplicable: boolean,
  tauxCommission = 0,
): TotauxDevis {
  // Les montants affichés à l'artisan sont ceux qui s'imprimeront.
  const { ht, tva, ttc } = ventiler(lignes, tvaApplicable)
  let cout = 0
  for (const l of lignes) cout += l.quantite * l.cout_unitaire
  // La marge se calcule sur le HT : la TVA n'est qu'encaissée pour l'État,
  // elle ne rentre jamais dans la poche de l'artisan.
  const marge = ht - cout

  return {
    ht,
    tva,
    ttc,
    cout,
    marge,
    margePct: ht > 0 ? (marge / ht) * 100 : 0,
    // La commission porte sur le TTC : c'est l'assiette de l'article 5 du
    // contrat d'apport d'affaires.
    commission: ttc * tauxCommission,
  }
}

/**
 * Unités pour lesquelles une même cote se répète de ligne en ligne.
 *
 * Un ravalement de 120 m² porte la même surface sur le nettoyage, le piquage,
 * le gobetis et l'enduit. L'artisan connaît ce chiffre ; il ne devrait pas
 * avoir à le retaper quatre fois.
 */
export const UNITES_COTE = ['m²', 'ml', 'm³']

/**
 * L'unité métrique la plus représentée parmi les lignes remplies, dès lors
 * qu'elle en porte au moins deux.
 *
 * Au-dessous de deux, proposer un champ « cote commune » ferait perdre plus de
 * temps qu'il n'en fait gagner. Les lignes sans désignation ne comptent pas :
 * ce sont des lignes vides que l'artisan n'a pas encore remplies.
 *
 * @returns `[unité, nombre de lignes]`, ou `null` s'il n'y a pas de cote commune.
 */
export function uniteCommune(
  lignes: { designation: string; unite: string; quantite?: string }[],
): [string, number] | null {
  const compte = new Map<string, number>()
  for (const l of lignes)
    // Seules les lignes restées à la quantité par défaut. Un entretien qui a
    // déjà chiffré 10 m² de menuiseries fixes et 10 m² de coulissantes ne doit
    // pas les voir passer à la surface du sol.
    if (l.designation.trim() && UNITES_COTE.includes(l.unite) && estQuantiteParDefaut(l.quantite))
      compte.set(l.unite, (compte.get(l.unite) ?? 0) + 1)

  let tete: [string, number] | null = null
  for (const e of compte) if (!tete || e[1] > tete[1]) tete = e
  return tete && tete[1] >= 2 ? tete : null
}

/** Une quantité que personne n'a encore touchée : vide, ou le 1 par défaut. */
export function estQuantiteParDefaut(q: string | undefined): boolean {
  const t = (q ?? '1').trim()
  return t === '' || t === '1'
}
