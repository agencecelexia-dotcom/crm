import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { modeleDuReleve, verifierModele } from '../../supabase/functions/_modele3d'
import type { Releve } from '../../supabase/functions/_releve'
import { facadeRetenue, orientationsDesFacades, pansParDefaut, toitRetenu } from '../../supabase/functions/_releve-retenu'
import { rapportMetre } from '../../src/features/metre/rapport-metre'

// L'audit indépendant du 29/09/2026 : six bâtiments, mesurés à part dans le
// MNS/MNT LiDAR HD et la BD TOPO de l'IGN. Ses références deviennent des
// assertions : ce que l'audit a trouvé juste ne doit plus bouger, ce qu'il a
// trouvé faux doit rester corrigé.
//
// Les maisons sont les nuages de points figés de tests/fixtures/copc. Les
// quatre autres bâtiments de l'audit (Oullins, Oucques 1b et 6 rue H.
// Berthelemy, Nogent 44) s'y ajoutent dès qu'ils sont figés :
//   npx jiti scripts/figer-toits.ts <nom> <cleabs> <lon> <lat>
//   npx jiti scripts/figer-nuages.ts <nom> && npx jiti scripts/figer-nuages.ts --releve <nom>
// puis une entrée dans REFERENCES ci-dessous.

const DOSSIER = fileURLToPath(new URL('../fixtures/copc', import.meta.url))

interface Reference {
  /** Le dossier figé. */
  nom: string
  adresse: string
  /** Pente des pans (médiane R-MNS de l'audit), en %, à ±3 points. */
  pente: number
  /** Surface du toit, tout compris (R-MNS), à ±7,5 %. */
  toitR_MNS: number
  /** Faîtage : BD TOPO altitude maximale − MNT médian, à ±0,5 m. */
  faitage: number
  /** Gouttière : les deux références de l'audit (BD TOPO − MNT médian ; `hauteur` BD TOPO). */
  gouttiere: [number, number]
}

const REFERENCES: Reference[] = [
  { nom: 'terrasse', adresse: '27 bis rue François Rolland, Nogent-sur-Marne', pente: 57, toitR_MNS: 173.4, faitage: 8.92, gouttiere: [7.22, 9.5] },
  { nom: 'deux-pans-simple', adresse: '1 allée des Sapins, Sathonay-Camp', pente: 36, toitR_MNS: 115.4, faitage: 7.57, gouttiere: [6.37, 6.8] },
]

const releve = (nom: string) => JSON.parse(readFileSync(join(DOSSIER, nom, 'releve.json'), 'utf8')) as Releve

describe.each(REFERENCES.filter((x) => existsSync(join(DOSSIER, x.nom, 'releve.json'))))('audit : $adresse', (ref) => {
  const r = releve(ref.nom)
  const retenus = pansParDefaut(r)
  const toit = toitRetenu(r, retenus)

  it('lit la pente des pans à 3 points près', () => {
    expect(Math.abs(toit.penteDesPans - ref.pente)).toBeLessThanOrEqual(3)
  })

  it('lit la surface du toit à 7,5 % près', () => {
    expect(Math.abs(r.surfaces.toitVrai - ref.toitR_MNS) / ref.toitR_MNS).toBeLessThanOrEqual(0.075)
  })

  it('met le faîtage à 50 cm près', () => {
    expect(Math.abs(r.hauteurs.faitage! - ref.faitage)).toBeLessThanOrEqual(0.5)
  })

  it('donne une hauteur à la gouttière, dans les références de l’audit (au dessous de la couverture, sol au pied du mur)', () => {
    const g = r.hauteurs.gouttiere
    expect(g).not.toBeNull()
    // Les références se lisent sur le toit (BD TOPO) : 25 cm de couverture et le débord les séparent du dessous du mur.
    expect(g!).toBeGreaterThan(Math.min(...ref.gouttiere) - 0.8)
    expect(g!).toBeLessThan(Math.max(...ref.gouttiere) + 0.3)
  })

  it('appelle « Façade X » l’orientation entière, une seule fois', () => {
    const rapport = rapportMetre({ titre: null, adresse: null, date: new Date(0), releve: r, pans: null, photos: [], materiaux: null })
    const lignes = rapport.lignes.filter((l) => l.rubrique === 'Façades' && l.element.endsWith(', brute'))
    expect(lignes).toHaveLength(orientationsDesFacades(r).length)
    for (const o of orientationsDesFacades(r)) {
      const f = facadeRetenue(r, o)
      const ligne = rapport.lignes.find((l) => l.element.startsWith(`Façade ${o}`) && l.element.endsWith(', brute'))!
      expect(ligne.quantite).toBe(f.surface)
    }
  })

  it('numérote les pans : deux pans de même exposition ne portent pas le même nom', () => {
    const rapport = rapportMetre({ titre: null, adresse: null, date: new Date(0), releve: r, pans: null, photos: [], materiaux: null })
    const noms = rapport.toiture.pans.map((p) => p.nom)
    expect(new Set(noms).size).toBe(noms.length)
  })

  it('dessine une maison sans défaut', () => {
    expect(verifierModele(modeleDuReleve(r), r)).toEqual([])
  })
})

describe('audit : Nogent 27 bis, la terrasse', () => {
  const r = releve('terrasse')

  it('ne compte pas la terrasse dans la pente des pans, et la dit à part', () => {
    const t = toitRetenu(r, pansParDefaut(r))
    expect(t.platPlan).toBe(0)
    // La pente équivalente inclurait la terrasse : elle est plus basse.
    expect(toitRetenu(r, null).pente).toBeLessThan(t.pente)
    expect(toitRetenu(r, null).platPlan).toBeGreaterThan(10)
  })

  it('sépare les murs en retrait au-dessus de la terrasse de la façade sud', () => {
    const sud = facadeRetenue(r, 'sud')
    expect(sud.murs.length).toBeGreaterThan(1)
    expect(sud.retrait.longueur).toBeGreaterThan(3)
    expect(sud.retrait.surface).toBeGreaterThan(20)
    // « Façade sud » = tout : 18 m à l'export, dont la part en retrait est dite à côté.
    expect(sud.longueur).toBeGreaterThan(sud.retrait.longueur)
  })

  it('la fourchette de gouttière dit que le terrain est en pente', () => {
    expect(r.hauteurs.gouttiereMax! - r.hauteurs.gouttiereMin!).toBeGreaterThan(0.5)
  })
})
