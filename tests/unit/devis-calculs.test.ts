import { describe, expect, it } from 'vitest'
import { arrondi, calculerTotaux, type LigneChiffrable, uniteCommune, ventiler } from '../../src/features/devis/calculs'

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

describe('uniteCommune — la cote saisie une seule fois', () => {
  const l = (designation: string, unite: string) => ({ designation, unite })

  it('retient l’unité métrique la plus représentée', () => {
    // Un ravalement type : quatre lignes au m², quatre au forfait.
    expect(
      uniteCommune([
        l('Installation échafaudage', 'forfait'),
        l('Nettoyage haute pression', 'm²'),
        l('Piquage de l’enduit', 'm²'),
        l('Gobetis d’accrochage', 'm²'),
        l('Enduit traditionnel', 'm²'),
        l('Protection des abords', 'forfait'),
        l('Évacuation des gravats', 'forfait'),
        l('Nettoyage de fin de chantier', 'forfait'),
      ]),
    ).toEqual(['m²', 4])
  })

  it('ne propose rien sous deux lignes', () => {
    expect(uniteCommune([l('Enduit', 'm²'), l('Échafaudage', 'forfait')])).toBeNull()
  })

  it('ignore les lignes vides que l’artisan n’a pas encore remplies', () => {
    expect(uniteCommune([l('Enduit', 'm²'), l('  ', 'm²'), l('', 'm²')])).toBeNull()
  })

  it('ne retient pas le forfait : deux forfaits ne partagent aucune cote', () => {
    expect(uniteCommune([l('Échafaudage', 'forfait'), l('Nettoyage', 'forfait')])).toBeNull()
  })

  it('départage en faveur de l’unité la plus fréquente', () => {
    expect(
      uniteCommune([l('Clôture', 'ml'), l('Bordure', 'ml'), l('Dalle', 'm²'), l('Terrasse', 'm²'), l('Mur', 'ml')]),
    ).toEqual(['ml', 3])
  })
})

describe('uniteCommune — ne pas écraser une quantité déjà posée', () => {
  const l = (designation: string, unite: string, quantite = '1') => ({ designation, unite, quantite })

  it('ignore les lignes que l’entretien a déjà chiffrées', () => {
    // Le cas de l'audit : deux menuiseries à 10 m² ne doivent pas passer à la
    // surface du sol parce que celle-ci porte la cote commune.
    expect(
      uniteCommune([
        l('Menuiserie fixe', 'm²', '10'),
        l('Menuiserie coulissante', 'm²', '10'),
        l('Sol', 'm²', '25'),
      ]),
    ).toBeNull()
  })

  it('compte celles qui restent à la quantité par défaut', () => {
    expect(
      uniteCommune([l('Nettoyage', 'm²'), l('Piquage', 'm²'), l('Menuiserie', 'm²', '10')]),
    ).toEqual(['m²', 2])
  })

  it('traite la quantité vide comme un défaut', () => {
    expect(uniteCommune([l('Nettoyage', 'm²', ''), l('Piquage', 'm²', '1')])).toEqual(['m²', 2])
  })
})

describe('ventiler — ce qui s’imprime doit s’additionner', () => {
  // Les trois cas relevés par l'audit sur de vrais PDF générés.
  it('5 × 33,33 € à 10 % : HT + TVA = TTC, au centime', () => {
    const v = ventiler([{ quantite: 5, prix_unitaire: 33.33, tva_taux: 10 }], true)
    expect(v.ht).toBe(166.65)
    expect(v.tva).toBe(16.67)
    expect(v.ttc).toBe(183.32) // le PDF imprimait 183,31
    expect(arrondi(v.ht + v.tva)).toBe(v.ttc)
  })

  it('multi-taux : les TVA imprimées somment exactement au TTC', () => {
    const v = ventiler(
      [
        { quantite: 1, prix_unitaire: 1556.25, tva_taux: 5.5 },
        { quantite: 1, prix_unitaire: 185.45, tva_taux: 10 },
        { quantite: 1, prix_unitaire: 327.78, tva_taux: 20 },
      ],
      true,
    )
    const somme = arrondi(v.ht + v.parTaux.reduce((s, x) => s + x.tva, 0))
    expect(v.ttc).toBe(somme)
    expect(v.parTaux.map((x) => x.taux)).toEqual([5.5, 10, 20])
  })

  it('les lignes imprimées somment exactement au HT imprimé', () => {
    const lignes = [
      { quantite: 12.5, prix_unitaire: 33.33, tva_taux: 10 },
      { quantite: 12.5, prix_unitaire: 33.33, tva_taux: 10 },
      { quantite: 1, prix_unitaire: 0.05, tva_taux: 10 },
      { quantite: 1, prix_unitaire: 0.05, tva_taux: 10 },
    ]
    const v = ventiler(lignes, true)
    expect(arrondi(v.lignes.reduce((s, m) => s + m, 0))).toBe(v.ht)
  })

  // Sur mille devis tirés au hasard, aucune incohérence d'un centime.
  it('aucun écart sur 1 000 devis aléatoires', () => {
    let graine = 7
    const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < 1000; k++) {
      const lignes = Array.from({ length: 1 + Math.floor(alea() * 8) }, () => ({
        quantite: Math.round(alea() * 400) / 4,
        prix_unitaire: Math.round(alea() * 50000) / 100,
        tva_taux: [5.5, 10, 20][Math.floor(alea() * 3)],
      }))
      const v = ventiler(lignes, true)
      expect(arrondi(v.lignes.reduce((s, m) => s + m, 0))).toBe(v.ht)
      expect(arrondi(v.ht + v.parTaux.reduce((s, x) => s + x.tva, 0))).toBe(v.ttc)
    }
  })

  it('arrondit 1,005 à 1,01 malgré le flottant', () => {
    expect(arrondi(1.005)).toBe(1.01)
    expect(arrondi(-1.005)).toBe(-1.01)
    expect(arrondi(0)).toBe(0)
  })

  it('en franchise, pas de TVA : TTC = HT', () => {
    const v = ventiler([{ quantite: 3, prix_unitaire: 10.005, tva_taux: 20 }], false)
    expect(v.tva).toBe(0)
    expect(v.ttc).toBe(v.ht)
  })
})
