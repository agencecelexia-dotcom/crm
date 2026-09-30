import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { depuisLambert93, versLambert93 } from '../../supabase/functions/_calcul-toit'
import { decoderNuage, encoderNuage } from '../../supabase/functions/_nuage'
import { hauteurGouttiere, releverBatiment, type Releve } from '../../supabase/functions/_releve'
import { facadeRetenue, lignesRetenues, orientationsDesFacades, pansParDefaut, toitRetenu } from '../../supabase/functions/_releve-retenu'
import { quantitesDuReleve } from '../../supabase/functions/_mesures-chantier'
import { boitePlate, contourDe, deuxPans, nuageDe, polygoneDe, quatrePans, type Scene } from './aide-nuage'

// Le relevé d'une maison dans son nuage de points LiDAR.
//
// D'abord des toits SYNTHÉTIQUES, aux dimensions connues : le relevé doit les
// retrouver — déplacement du cadastre, débord, pente, surface, hauteurs.
// Puis des maisons RÉELLES, figées (scripts/figer-nuages.ts) : leur relevé ne
// change pas sans qu'on le veuille, et tient ce qu'on sait d'elles.

const pres = (v: number, attendu: number, ecartRelatif: number) =>
  expect(Math.abs(v - attendu) / attendu).toBeLessThanOrEqual(ecartRelatif)
const entre = (v: number, min: number, max: number) => {
  expect(v).toBeGreaterThan(min)
  expect(v).toBeLessThan(max)
}

describe('Lambert-93 dans les deux sens', () => {
  it('revient au point de départ', () => {
    for (const [lon, lat] of [
      [4.8703553, 45.81760704],
      [-4.5, 48.4],
      [7.5, 43.7],
      [2.35, 51.0],
    ]) {
      const [x, y] = versLambert93(lon, lat)
      const [lon2, lat2] = depuisLambert93(x, y)
      expect(Math.abs(lon2 - lon)).toBeLessThan(1e-9)
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-9)
    }
  })
})

describe('toit synthétique à deux pans, cadastre décalé', () => {
  const scene: Scene = {
    origine: [845000, 6525000],
    rotation: 25,
    volumes: [deuxPans({ l: 8, y0: -6, y1: 6, p: 0.7, d: 0.5, h: 5 })],
  }
  const { nuage, zone } = nuageDe(scene)
  const r = releverBatiment({ nuage, zone, contour: contourDe(scene, [-4, -6, 4, 6], [1.6, -2.2]), voisins: [], vol: null })

  it('retrouve le déplacement du cadastre à 10 cm près', () => {
    expect(r.recalage.fiable).toBe(true)
    expect(Math.abs(r.recalage.dx + 1.6)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(r.recalage.dy - 2.2)).toBeLessThanOrEqual(0.1)
  })

  it('mesure le débord de chaque côté à 8 cm près', () => {
    for (const b of r.bords) {
      expect(b.etat).toBe('mesure')
      expect(Math.abs(b.debord! - 0.5)).toBeLessThanOrEqual(0.08)
    }
  })

  it('lit deux pans à 70 %, et la surface à 1,5 % près', () => {
    expect(r.pans).toHaveLength(2)
    for (const p of r.pans) expect(Math.abs(p.pente - 70)).toBeLessThanOrEqual(1)
    pres(r.surfaces.toitPlan, 9 * 13, 0.015)
    pres(r.surfaces.toitVrai, 9 * 13 * Math.sqrt(1 + 0.7 ** 2), 0.015)
    expect(r.confiance).toBe('haute')
  })

  it('mesure le faîtage, les égouts et les rives à 2 % près', () => {
    const { totaux } = lignesRetenues(r, null)
    pres(totaux.faitage.longueur, 13, 0.02)
    pres(totaux.egout.longueur, 26, 0.02)
    pres(totaux.rive.longueur, 4 * 4.5 * Math.sqrt(1 + 0.7 ** 2), 0.02)
    expect(totaux.aretier.nombre + totaux.noue.nombre).toBe(0)
  })

  it('donne la hauteur à la gouttière : le dessous de la couverture au droit du mur', () => {
    expect(Math.abs(r.hauteurs.gouttiere! - 4.75)).toBeLessThanOrEqual(0.1)
    // Sur ce toit le terrain est plat : l'éventail est étroit.
    expect(r.hauteurs.gouttiereMax! - r.hauteurs.gouttiereMin!).toBeLessThanOrEqual(0.3)
  })

  it('dessine deux gouttereaux et deux pignons', () => {
    const longs = r.facades.filter((f) => Math.abs(f.longueur - 12) < 0.2)
    const courts = r.facades.filter((f) => Math.abs(f.longueur - 8) < 0.2)
    expect(longs).toHaveLength(2)
    expect(courts).toHaveLength(2)
    for (const f of longs) {
      expect(f.type).toBe('gouttereau')
      expect(Math.abs(f.hauteurBasse - 4.75)).toBeLessThanOrEqual(0.1)
      pres(f.surface, 12 * 4.75, 0.02)
    }
    for (const f of courts) {
      expect(f.type).toBe('pignon')
      expect(Math.abs(f.hauteurHaute - (4.75 + 0.7 * 4))).toBeLessThanOrEqual(0.15)
      pres(f.surface, 8 * 4.75 + 0.5 * 8 * 0.7 * 4, 0.02)
    }
  })
})

describe('toit synthétique à quatre pans', () => {
  const scene: Scene = {
    origine: [640000, 6860000],
    rotation: -40,
    volumes: [quatrePans({ l: 9, L: 14, p: 0.35, d: 0.3, h: 5.5 })],
    densite: 12,
  }
  const { nuage, zone } = nuageDe(scene)
  const r = releverBatiment({ nuage, zone, contour: contourDe(scene, [-4.5, -7, 4.5, 7]), voisins: [], vol: null })

  it('lit quatre pans à 35 %, et la surface à 1,5 % près', () => {
    expect(r.pans).toHaveLength(4)
    for (const p of r.pans) expect(Math.abs(p.pente - 35)).toBeLessThanOrEqual(1)
    pres(r.surfaces.toitVrai, 9.6 * 14.6 * Math.sqrt(1 + 0.35 ** 2), 0.015)
  })

  it('mesure le faîtage, les quatre arêtiers et les égouts', () => {
    const { totaux } = lignesRetenues(r, null)
    pres(totaux.faitage.longueur, 14.6 - 9.6, 0.05)
    expect(totaux.aretier.nombre).toBe(4)
    // Un arêtier : la demi-largeur en diagonale, redressée de sa pente.
    const plan = 4.8 * Math.SQRT2
    pres(totaux.aretier.longueur, 4 * plan * Math.sqrt(1 + ((0.35 * 4.8) / plan) ** 2), 0.03)
    pres(totaux.egout.longueur, 2 * (9.6 + 14.6), 0.02)
    expect(totaux.rive.longueur).toBe(0)
  })

  it('ne trouve que des gouttereaux', () => {
    expect(r.facades).toHaveLength(4)
    for (const f of r.facades) {
      expect(f.type).toBe('gouttereau')
      expect(Math.abs(f.hauteurBasse - 5.25)).toBeLessThanOrEqual(0.1)
    }
  })

  it('la somme des pans fait le toit', () => {
    const somme = r.pans.reduce((s, p) => s + p.aireVraie, 0)
    expect(Math.abs(somme - r.surfaces.toitVrai)).toBeLessThanOrEqual(0.2)
    const plan = r.pans.reduce((s, p) => s + p.airePlan, 0)
    expect(Math.abs(plan - r.surfaces.toitPlan)).toBeLessThanOrEqual(0.2)
  })
})

describe('maison en L : deux faîtages et deux noues', () => {
  const scene: Scene = {
    origine: [700000, 6700000],
    rotation: 15,
    volumes: [
      deuxPans({ l: 8, y0: -6, y1: 6, p: 0.7, d: 0.5, h: 5 }),
      // L'aile, faîtage selon x, aussi haute à l'égout, donc plus basse au faîtage.
      { toit: (x, y) => (x >= 0 && x <= 12.5 && Math.abs(y) <= 3.5 ? 5 + 0.7 * (3 - Math.abs(y)) : null) },
    ],
  }
  const { nuage, zone } = nuageDe({ ...scene, demiCote: 22 })
  const th = (scene.rotation * Math.PI) / 180
  const murs = [[-4, -6], [4, -6], [4, -3], [12, -3], [12, 3], [4, 3], [4, 6], [-4, 6]].map(([u, v]) =>
    depuisLambert93(
      scene.origine[0] + u * Math.cos(th) - v * Math.sin(th),
      scene.origine[1] + u * Math.sin(th) + v * Math.cos(th),
    ),
  )
  const r = releverBatiment({ nuage, zone, contour: murs, voisins: [], vol: null })
  const { totaux } = lignesRetenues(r, null)

  it('lit quatre pans', () => {
    expect(r.pans).toHaveLength(4)
  })
  it('mesure les faîtages (13 + 11,5 m) et les deux noues', () => {
    pres(totaux.faitage.longueur, 24.5, 0.03)
    expect(totaux.noue.nombre).toBe(2)
    // Une noue : de la jonction des faîtages au coin rentrant, redressée de sa pente.
    const plan = Math.SQRT2 * 3.5
    pres(totaux.noue.longueur, 2 * plan * Math.sqrt(1 + ((0.7 * 3.5) / plan) ** 2), 0.04)
  })
  it('mesure les égouts et les rives', () => {
    pres(totaux.egout.longueur, 13 + 6 + 16, 0.03)
    pres(totaux.rive.longueur, (4 * 4.5 + 2 * 3.5) * Math.sqrt(1 + 0.7 ** 2), 0.03)
  })
})

describe('maison mitoyenne : le toit continue chez le voisin', () => {
  const scene: Scene = {
    origine: [990000, 6300000],
    rotation: 10,
    volumes: [deuxPans({ l: 8, y0: -6, y1: 18, p: 0.7, d: 0.5, h: 5 })],
  }
  const { nuage, zone } = nuageDe({ ...scene, demiCote: 24 })
  const decalage: [number, number] = [0.8, 0.5]
  const r = releverBatiment({
    nuage,
    zone,
    contour: contourDe(scene, [-4, -6, 4, 6], decalage),
    voisins: [contourDe(scene, [-4, 6, 4, 18], decalage)],
    vol: null,
  })

  it('recale la maison et son voisin ensemble', () => {
    expect(r.recalage.fiable).toBe(true)
    expect(Math.abs(r.recalage.dx + 0.8)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(r.recalage.dy + 0.5)).toBeLessThanOrEqual(0.1)
  })

  it('arrête le toit au mur mitoyen', () => {
    const mitoyens = r.bords.filter((b) => b.etat === 'accole')
    expect(mitoyens).toHaveLength(1)
    expect(mitoyens[0].debord).toBe(0)
    pres(r.surfaces.toitPlan, 9 * 12.5, 0.015)
  })

  it('ne met ni égout ni rive le long du mur mitoyen', () => {
    const { totaux } = lignesRetenues(r, null)
    pres(totaux.egout.longueur, 2 * 12.5, 0.03)
    // Les rives du seul pignon libre.
    pres(totaux.rive.longueur, 2 * 4.5 * Math.sqrt(1 + 0.7 ** 2), 0.03)
  })

  it('ne compte pas le mur mitoyen dans la façade à peindre', () => {
    const mitoyen = r.facades.find((f) => f.accole > 7)
    expect(mitoyen).toBeDefined()
    expect(mitoyen!.surfaceLibre).toBeLessThan(1)
  })
})

it('sans toit sous le contour, le relevé le dit', () => {
  const scene: Scene = { origine: [700000, 6600000], rotation: 0, volumes: [] }
  const { nuage, zone } = nuageDe(scene)
  const r = releverBatiment({ nuage, zone, contour: contourDe(scene, [-4, -6, 4, 6]), voisins: [], vol: null })
  expect(r.motif).toBe('maison_absente')
  expect(r.confiance).toBe('basse')
  expect(r.pans).toHaveLength(0)
})

// ---------- Maisons réelles ----------

const DOSSIER = fileURLToPath(new URL('../fixtures/copc', import.meta.url))

interface Jeu {
  nom: string
  contour: [number, number][]
  voisins?: { contour: [number, number][] }[]
  routes?: [number, number][][]
  zone: { minX: number; minY: number; maxX: number; maxY: number }
  dalles: { vol: string | null }[]
}

const jeux = readdirSync(DOSSIER)
  .sort()
  .map((nom) => JSON.parse(readFileSync(join(DOSSIER, nom, 'maison.json'), 'utf8')) as Jeu)

function relever(j: Jeu): Releve {
  const nuage = decoderNuage(new Uint8Array(gunzipSync(readFileSync(join(DOSSIER, j.nom, 'nuage.bin.gz')))))
  return releverBatiment({
    nuage,
    zone: j.zone,
    contour: j.contour,
    voisins: (j.voisins ?? []).map((v) => v.contour),
    routes: j.routes ?? [],
    vol: j.dalles[0]?.vol ?? null,
  })
}

/** Ce qu'on sait de chaque maison, vu sur la photo et dans les points. */
const connu: Record<string, (r: Releve) => void> = {
  'deux-pans-simple': (r) => {
    // Sathonay-Camp : toit à croupes (un faîtage, quatre arêtiers), cadastre décalé de 45 cm.
    expect(r.pans).toHaveLength(4)
    for (const p of r.pans) entre(p.pente, 33, 37)
    expect(Math.hypot(r.recalage.dx, r.recalage.dy)).toBeGreaterThan(0.3)
    for (const b of r.bords) expect(b.debord!).toBeGreaterThan(0.25)
  },
  croupe: (r) => {
    // Saint-Aygulf : dix pans, tous à 31 % environ.
    expect(r.pans.length).toBeGreaterThanOrEqual(7)
    for (const p of r.pans) entre(p.pente, 29, 34)
  },
  'deux-pans-raides': (r) => {
    // Saint-Urbain (Finistère) : deux pans à 85 %, pignons sans débord.
    expect(r.pans).toHaveLength(2)
    for (const p of r.pans) entre(p.pente, 83, 86)
    expect(r.facades.filter((f) => f.type === 'pignon')).toHaveLength(2)
    expect(Math.abs(r.debord.moyen!)).toBeLessThan(0.2)
  },
  dissymetrique: (r) => {
    // Bromines (Haute-Savoie) : un mètre de débord.
    expect(r.debord.moyen!).toBeGreaterThan(0.9)
  },
  terrasse: (r) => {
    // Nogent-sur-Marne : la terrasse surélevée est dans le contour du cadastre.
    // Elle est lue à part, marquée, et hors du compte par défaut.
    const terrasses = r.pans.filter((p) => p.terrasse)
    expect(terrasses).toHaveLength(1)
    expect(terrasses[0].orientation).toBe('plat')
    const defaut = toitRetenu(r, pansParDefaut(r))
    expect(defaut.vrai).toBeLessThan(r.surfaces.toitVrai - 10)
    for (const p of r.pans.filter((q) => !q.terrasse)) entre(p.pente, 56, 63)
  },
  accolee: (r) => {
    // Keskastel : le pignon sud-ouest est mitoyen.
    expect(r.pans).toHaveLength(2)
    expect(r.bords.filter((b) => b.etat === 'accole')).toHaveLength(1)
    expect(r.facades.find((f) => f.orientation === 'sud-ouest')!.surfaceLibre).toBe(0)
  },
}

it('les maisons figées sont là', () => {
  expect(jeux.map((j) => j.nom)).toEqual(expect.arrayContaining(Object.keys(connu)))
})

describe.each(jeux)('maison réelle : $nom', (j) => {
  const r = relever(j)

  it('rend le même relevé que le jour où il a été figé', () => {
    const fichier = join(DOSSIER, j.nom, 'releve.json')
    expect(existsSync(fichier)).toBe(true)
    expect(JSON.parse(JSON.stringify(r))).toEqual(JSON.parse(readFileSync(fichier, 'utf8')))
  })

  it('tient ce qu’on sait d’elle', () => connu[j.nom]?.(r))

  it('tient ses invariants', () => {
    expect(r.motif).toBeNull()
    const somme = r.pans.reduce((s, p) => s + p.aireVraie, 0)
    expect(Math.abs(somme - r.surfaces.toitVrai)).toBeLessThanOrEqual(0.3)
    expect(r.surfaces.toitVrai).toBeGreaterThanOrEqual(r.surfaces.toitPlan)
    for (const f of r.facades) {
      expect(f.surfaceLibre).toBeLessThanOrEqual(f.surface + 0.05)
      expect(f.hauteurHaute).toBeLessThan(15)
    }
    expect(Math.abs(r.recalage.dx)).toBeLessThanOrEqual(6)
  })
})

// ---------- Enregistré = affiché ----------
//
// L'écran additionne les pans retenus (et les murs d'une façade) ; la base
// refait la même addition en `numeric` à l'enregistrement (0178). Les valeurs
// de référence sont celles que la base a rendues pour les relevés figés.

describe('enregistré = affiché : les additions du relevé', () => {
  const reference = JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/releve-reference-sql.json', import.meta.url)), 'utf8'),
  ) as {
    releves: {
      nom: string
      tout: { plan: number; vrai: number; pente: number }
      pan1: { plan: number; vrai: number; pente: number }
      facades: { orientation: string; surface: number; longueur: number }[]
    }[]
  }

  it.each(reference.releves)('$nom : même toit, même façades que la base', (ref) => {
    const r = JSON.parse(readFileSync(join(DOSSIER, ref.nom, 'releve.json'), 'utf8')) as Releve
    const tout = toitRetenu(r, null)
    expect({ plan: tout.plan, vrai: tout.vrai, pente: tout.pente }).toEqual(ref.tout)
    const pan1 = toitRetenu(r, [1])
    expect({ plan: pan1.plan, vrai: pan1.vrai, pente: pan1.pente }).toEqual(ref.pan1)
    for (const f of ref.facades) {
      const e = facadeRetenue(r, f.orientation)
      expect({ orientation: f.orientation, surface: e.surface, longueur: e.longueur }).toEqual(f)
    }
  })
})

describe('pré-mesure = écran : le dossier reçoit les chiffres que l’écran affiche', () => {
  it.each(jeux)('$nom', (j) => {
    const r = JSON.parse(readFileSync(join(DOSSIER, j.nom, 'releve.json'), 'utf8')) as Releve
    const q = Object.fromEntries(quantitesDuReleve(r).map((x) => [x.cle, x.valeur]))
    // L'écran compte d'office tous les pans, sauf les terrasses.
    const defaut = pansParDefaut(r)
    // Ce que lit l'artisan (panneau-batiment.tsx) : la somme des pans, les
    // façades hors mitoyen, la gouttière mesurée.
    expect(q.toit_surface).toBe(toitRetenu(r, defaut).vrai)
    expect(q.toit_pente).toBe(toitRetenu(r, defaut).pente)
    expect(q.toit_pans).toBe(toitRetenu(r, defaut).nb)
    const facades = orientationsDesFacades(r).reduce((s, o) => s + facadeRetenue(r, o).surface, 0)
    expect(q.facades_total).toBe(Math.round(facades * 100) / 100)
    expect(q.hauteur_murs ?? null).toBe(r.hauteurs.gouttiere)
    const { totaux } = lignesRetenues(r, defaut)
    expect(q.faitage).toBe(Math.round(totaux.faitage.longueur * 10) / 10)
    expect(q.egouts).toBe(Math.round(totaux.egout.longueur * 10) / 10)
    expect(q.rives).toBe(Math.round(totaux.rive.longueur * 10) / 10)
    expect(q.aretiers).toBe(Math.round(totaux.aretier.longueur * 10) / 10)
    expect(q.noues).toBe(Math.round(totaux.noue.longueur * 10) / 10)
  })
})

it('garde l’extrait d’un grand bâtiment sans déborder la pile', () => {
  // 300 000 points : `Math.min(...z)` faisait « Maximum call stack size exceeded ».
  const n = 300_000
  const nu = { x: new Float64Array(n).fill(845000), y: new Float64Array(n).fill(6525000), z: new Float64Array(n).map((_, i) => 200 + (i % 1000) / 100), classe: new Uint8Array(n).fill(2), nb: n }
  const zone = { minX: 844990, minY: 6524990, maxX: 845010, maxY: 6525010 }
  const lu = decoderNuage(encoderNuage([nu], zone))
  expect(lu.nb).toBe(n)
  expect(lu.z[999]).toBeCloseTo(209.99, 2)
})

describe('la hauteur à la gouttière ne se laisse pas tirer par une annexe', () => {
  it('pèse chaque hauteur à sa longueur : 24 m d’égout à 4,75 m et 3 m d’annexe à 1,5 m', () => {
    const g = hauteurGouttiere(
      [{ h: 4.75, l: 24 }, { h: 1.5, l: 3 }],
      [],
    )!
    expect(g.mediane).toBe(4.75)
  })

  it('retrouve celle de la longue façade même si les petits murs sont plus nombreux', () => {
    const egouts = [{ h: 6.9, l: 12 }, ...Array.from({ length: 5 }, () => ({ h: 2.1, l: 1.5 }))]
    expect(hauteurGouttiere(egouts, [])!.mediane).toBe(6.9)
  })

  it('en existe une même sans égout lu : la médiane des murs à leur longueur', () => {
    const g = hauteurGouttiere([], [
      { surfaceLibre: 40, hauteurBasse: 4.2, longueur: 10 },
      { surfaceLibre: 8, hauteurBasse: 1.1, longueur: 2 },
    ])
    expect(g?.mediane).toBe(4.2)
  })

  it('n’en invente pas sans mur ni égout', () => {
    expect(hauteurGouttiere([], [])).toBeNull()
  })
})

describe('la pente que lit le couvreur', () => {
  it('ne se dilue ni dans une partie plate ni dans un petit pan doux (Nogent 44 : 48 et 49 %, plat, 20 %) : la médiane des pans, à leur surface', () => {
    const pan = (id: number, orientation: string, pente: number, plan: number) =>
      ({ id, orientation, pente, airePlan: plan, aireVraie: plan * Math.sqrt(1 + (pente / 100) ** 2), terrasse: false }) as unknown as Releve['pans'][number]
    const r = { pans: [pan(1, 'plat', 0, 39.7), pan(2, 'nord', 48, 33), pan(3, 'sud', 49, 32), pan(4, 'sud', 20, 10.4)] } as Releve
    const t = toitRetenu(r, null)
    expect(t.penteDesPans).toBeGreaterThanOrEqual(48)
    expect(t.penteDesPans).toBeLessThanOrEqual(49)
    expect(t.pente).toBeLessThan(40)
    expect(t.platPlan).toBe(39.7)
  })
})

describe('maison à deux pans avec deux annexes basses collées : la gouttière est celle de la maison', () => {
  // La maison : 8 × 12 m, toit à deux pans, dessus du toit à 5 m au droit des murs.
  // Les annexes : 3 × 4 m, toit plat à 2,5 m, contre chaque pignon. Le contour est en H.
  const scene: Scene = {
    origine: [845000, 6525000],
    rotation: 25,
    volumes: [deuxPans({ l: 8, y0: -6, y1: 6, p: 0.7, d: 0.5, h: 5 }), boitePlate([4, -2, 7, 2], 2.5), boitePlate([-7, -2, -4, 2], 2.5)],
  }
  const { nuage, zone } = nuageDe(scene)
  const contour = polygoneDe(scene, [[-4, -6], [4, -6], [4, -2], [7, -2], [7, 2], [4, 2], [4, 6], [-4, 6], [-4, 2], [-7, 2], [-7, -2], [-4, -2]])
  const r = releverBatiment({ nuage, zone, contour, voisins: [], vol: null })

  it('lit les deux pans de la maison et les parties plates des annexes', () => {
    expect(r.pans.filter((p) => p.orientation !== 'plat')).toHaveLength(2)
    expect(r.pans.some((p) => p.orientation === 'plat')).toBe(true)
  })

  it('donne 4,75 m à la gouttière, pas la hauteur de l’annexe', () => {
    expect(Math.abs(r.hauteurs.gouttiere! - 4.75)).toBeLessThanOrEqual(0.15)
  })

  it('compte des murs plus bas que la gouttière (les annexes), qui ne la tirent pas', () => {
    expect(r.facades.some((f) => f.hauteurBasse < 3.5)).toBe(true)
  })
})
