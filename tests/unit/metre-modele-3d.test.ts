import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { aire3d, alleger, contourNet, contourPropre, modeleDuReleve, verifierModele } from '../../supabase/functions/_modele3d'
import { releverBatiment, type Releve } from '../../supabase/functions/_releve'
import { contourDe, deuxPans, nuageDe, type Scene } from './aide-nuage'

// Le modèle 3D tiré du relevé : ce qu'on dessine doit retrouver ce qu'on
// mesure, et chaque ouverture tomber à sa place sur son mur.

const DOSSIER = fileURLToPath(new URL('../fixtures/copc', import.meta.url))
const releves = readdirSync(DOSSIER)
  .sort()
  .map((nom) => ({ nom, r: JSON.parse(readFileSync(join(DOSSIER, nom, 'releve.json'), 'utf8')) as Releve }))

describe.each(releves)('maison réelle : $nom', ({ r }) => {
  const m = modeleDuReleve(r)

  it('dessine chaque pan et chaque mur', () => {
    expect(m.faces.filter((f) => f.type === 'pan')).toHaveLength(r.pans.length)
    // Chaque façade a son mur ; le modèle en ajoute pour fermer le volume (décrochés, bords de toit).
    const murs = m.faces.filter((f) => f.type === 'mur')
    for (const f of r.facades) expect(murs.some((x) => x.ref === String(f.index) && !x.complement)).toBe(true)
    expect(murs.filter((x) => !x.complement)).toHaveLength(r.facades.length)
  })

  it('n’a aucun défaut : pans nets, murs fermés, terrasse posée, pied de mur sans dents de scie', () => {
    expect(verifierModele(m, r)).toEqual([])
  })

  it('le toit dessiné retrouve la surface mesurée (à 5 % près)', () => {
    const dessin = m.faces.filter((f) => f.type === 'pan').reduce((s, f) => s + aire3d(f.sommets), 0)
    expect(Math.abs(dessin - r.surfaces.toitVrai) / r.surfaces.toitVrai).toBeLessThan(0.05)
  })

  it('chaque mur dessiné retrouve sa surface (à 5 % près)', () => {
    for (const f of r.facades) {
      const face = m.faces.find((x) => x.type === 'mur' && x.ref === String(f.index) && !x.complement)!
      if (f.surface < 5) continue
      // Un mur fait de plusieurs arêtes n'est pas plan : on somme ses tranches.
      let aire = 0
      const n = face.plan2d.length / 2
      for (let i = 0; i + 1 < n; i++) {
        const ds = face.plan2d[i + 1][0] - face.plan2d[i][0]
        const h0 = face.plan2d[face.plan2d.length - 1 - i][1] - face.plan2d[i][1]
        const h1 = face.plan2d[face.plan2d.length - 2 - i][1] - face.plan2d[i + 1][1]
        aire += (ds * (h0 + h1)) / 2
      }
      expect(Math.abs(aire - f.surface) / f.surface).toBeLessThan(0.05)
    }
  })

  it('pose le toit au-dessus des murs', () => {
    const hautMurs = Math.max(...m.faces.filter((f) => f.type === 'mur').flatMap((f) => f.sommets.map((p) => p[2])))
    const hautToit = Math.max(...m.faces.filter((f) => f.type === 'pan').flatMap((f) => f.sommets.map((p) => p[2])))
    expect(hautToit).toBeGreaterThan(hautMurs)
  })
})

describe('maison synthétique à deux pans', () => {
  const scene: Scene = { origine: [845000, 6525000], rotation: 25, volumes: [deuxPans({ l: 8, y0: -6, y1: 6, p: 0.7, d: 0.5, h: 5 })] }
  const { nuage, zone } = nuageDe(scene)
  const r = releverBatiment({ nuage, zone, contour: contourDe(scene, [-4, -6, 4, 6]), voisins: [], vol: null })

  it('met le faîtage à la bonne hauteur', () => {
    const m = modeleDuReleve(r)
    // Sol plat à 200 m ; faîtage : 5 + 0,7 × 4 = 7,8 m.
    expect(m.max[2]).toBeCloseTo(7.8, 0)
  })

  it('pose une ouverture lue au milieu de la photo au milieu du mur', () => {
    const sud = r.facades.find((f) => Math.abs(f.longueur - 8) < 0.3 && f.surfaceLibre > 0)!
    const m = modeleDuReleve(r, [
      {
        orientation: sud.orientation,
        lecture: {
          meme_maison: 'oui',
          cadre: { gauche: 100, haut: 100, droite: 900, bas: 900 },
          ligne_sol: 900,
          ligne_gouttiere: 400,
          ouvertures: [{ type: 'fenetre', gauche: 450, haut: 500, droite: 550, bas: 700 }],
        },
      },
    ])
    const o = m.faces.find((f) => f.type === 'ouverture')!
    expect(o).toBeDefined()
    // 1/8 de la largeur (1 m), 2/5 de la hauteur à la gouttière (4,75 × 0,4 = 1,9 m).
    expect(o.surface).toBeCloseTo(1 * 1.9, 1)
    const [s0, s1] = [o.plan2d[0][0], o.plan2d[1][0]]
    expect((s0 + s1) / 2).toBeCloseTo(sud.longueur / 2, 0)
  })
})

describe('contour d’un pan sans ses marches', () => {
  // Un demi-carré de 5 m, dont l'arête est tracée en marches de 25 cm.
  const marches: [number, number][] = [[0, 0], [5, 0], [5, 5]]
  for (let i = 19; i >= 1; i--) marches.push([i * 0.25, (i + 1) * 0.25], [i * 0.25, i * 0.25])
  marches.push([0, 0.25])

  it('se pose sur la ligne du toit', () => {
    const net = contourNet(marches, [{ a: [0, 0], b: [5, 5] }])
    expect(net).toHaveLength(3)
    expect(net).toContainEqual([5, 5])
  })

  it('garde le contour sans ligne à suivre', () => {
    expect(contourNet(marches, [])).toBe(marches)
  })

  it('garde le contour si le calage le déforme', () => {
    // Un petit pan à 60 cm d'une ligne : s'y poser l'agrandirait de moitié.
    const carre: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    expect(contourNet(carre, [{ a: [0, 1.6], b: [1, 1.6] }])).toBe(carre)
  })
})

describe.each(releves)('contours nettoyés : $nom', ({ r }) => {
  it('garde la surface du toit à 5 % près', () => {
    const m = modeleDuReleve(r)
    const dessin = m.faces.filter((f) => f.type === 'pan').reduce((s, f) => s + aire3d(f.sommets), 0)
    const brut = r.pans.reduce((s, p) => s + p.aireVraie, 0)
    expect(Math.abs(dessin - brut) / brut).toBeLessThan(0.05)
  })
})

describe('un contour de pan en escalier devient un tracé de toit', () => {
  // Un rectangle de 10 × 4 m dont le bas est une marche d'escalier de cases de 25 cm.
  const escalier = (): [number, number][] => {
    const P: [number, number][] = [[0, 0]]
    for (let i = 0; i < 40; i++) P.push([i * 0.25, (i % 2) * 0.25], [(i + 1) * 0.25, (i % 2) * 0.25])
    P.push([10, 4], [0, 4])
    return P
  }

  it('garde peu de sommets, sans se croiser, à 5 % près de l’aire', () => {
    const P = escalier()
    const L = alleger(P)
    expect(L.length).toBeLessThanOrEqual(12)
    const aire = (Q: [number, number][]) => Math.abs(Q.reduce((s, [x1, y1], i) => s + x1 * Q[(i + 1) % Q.length][1] - Q[(i + 1) % Q.length][0] * y1, 0) / 2)
    expect(Math.abs(aire(L) - aire(P))).toBeLessThan(0.05 * aire(P) + 1)
  })

  it('se cale sur la ligne du toit sans dépasser douze sommets', () => {
    const net = contourPropre(escalier(), [{ a: [0, 0.1], b: [10, 0.1] }])
    expect(net.length).toBeLessThanOrEqual(12)
    expect(net.length).toBeGreaterThanOrEqual(4)
  })

  it('laisse un rectangle propre tel quel', () => {
    const R: [number, number][] = [[0, 0], [8, 0], [8, 5], [0, 5]]
    expect(alleger(R)).toEqual(R)
  })
})
