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
