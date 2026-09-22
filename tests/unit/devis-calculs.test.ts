import { describe, expect, it } from 'vitest'
import { calculerTotaux, type LigneChiffrable } from '../../src/features/devis/calculs'

// Ce sont les chiffres sur lesquels l'artisan fixe son prix, et celui qui
// porte notre commission. Une erreur ici se voit sur une facture.

const ligne = (p: Partial<LigneChiffrable> = {}): LigneChiffrable => ({
  quantite: 1,
  prix_unitaire: 0,
  cout_unitaire: 0,
  tva_taux: 10,
  ...p,
})

describe('totaux du devis', () => {
  it('sans TVA, le TTC vaut le HT', () => {
    const t = calculerTotaux([ligne({ quantite: 10, prix_unitaire: 100, tva_taux: 20 })], false)
    expect(t.ht).toBe(1000)
    expect(t.tva).toBe(0)
    expect(t.ttc).toBe(1000)
  })

  it('mélange deux taux de TVA sur le même devis', () => {
    // Cas courant : 10 % sur la rénovation, 20 % sur le matériel ou le neuf.
    const t = calculerTotaux(
      [
        ligne({ quantite: 100, prix_unitaire: 45, tva_taux: 10 }), // 4 500 → 450
        ligne({ quantite: 1, prix_unitaire: 800, tva_taux: 20 }), //    800 → 160
      ],
      true,
    )
    expect(t.ht).toBe(5300)
    expect(t.tva).toBe(610)
    expect(t.ttc).toBe(5910)
  })

  it('calcule la marge sur le HT, jamais sur le TTC', () => {
    // 10 000 € HT, 6 000 € de déboursé → 4 000 € de marge, soit 40 %.
    // Si la TVA entrait dans le calcul, la marge paraîtrait meilleure qu'elle
    // n'est : cet argent est encaissé pour l'État, pas gagné.
    const t = calculerTotaux(
      [ligne({ quantite: 1, prix_unitaire: 10000, cout_unitaire: 6000, tva_taux: 20 })],
      true,
    )
    expect(t.marge).toBe(4000)
    expect(t.margePct).toBe(40)
    expect(t.ttc).toBe(12000)
  })

  it('applique la commission sur le TTC', () => {
    // Article 5 du contrat : la commission porte sur le montant TTC.
    const t = calculerTotaux(
      [ligne({ quantite: 1, prix_unitaire: 1000, tva_taux: 20 })],
      true,
      0.15,
    )
    expect(t.ttc).toBe(1200)
    expect(t.commission).toBe(180)
  })

  it('ne divise pas par zéro sur un devis vide', () => {
    const t = calculerTotaux([], true, 0.2)
    expect(t.margePct).toBe(0)
    expect(t.commission).toBe(0)
  })

  it('garde les taux de ligne quand on repasse en franchise', () => {
    // L'artisan doit pouvoir basculer entre les deux régimes sans perdre sa
    // saisie : les taux sont ignorés, pas effacés.
    const lignes = [ligne({ quantite: 2, prix_unitaire: 500, tva_taux: 20 })]
    expect(calculerTotaux(lignes, false).ttc).toBe(1000)
    expect(calculerTotaux(lignes, true).ttc).toBe(1200)
  })
})
