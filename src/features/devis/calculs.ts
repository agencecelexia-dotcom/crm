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
  let ht = 0
  let tva = 0
  let cout = 0

  for (const l of lignes) {
    const montant = l.quantite * l.prix_unitaire
    ht += montant
    if (tvaApplicable) tva += (montant * l.tva_taux) / 100
    cout += l.quantite * l.cout_unitaire
  }

  const ttc = ht + tva
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
  lignes: { designation: string; unite: string }[],
): [string, number] | null {
  const compte = new Map<string, number>()
  for (const l of lignes)
    if (l.designation.trim() && UNITES_COTE.includes(l.unite))
      compte.set(l.unite, (compte.get(l.unite) ?? 0) + 1)

  let tete: [string, number] | null = null
  for (const e of compte) if (!tete || e[1] > tete[1]) tete = e
  return tete && tete[1] >= 2 ? tete : null
}
