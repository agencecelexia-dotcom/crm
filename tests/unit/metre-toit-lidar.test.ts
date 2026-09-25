import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  lireGeoTiff,
  mesurerToit,
  versLambert93,
  type LireGrille,
  type ResultatToit,
} from '../../supabase/functions/_calcul-toit'
import { lectureParPans, type Toiture } from '@/features/metre/toiture'

// Des toits RÉELS, rejoués sans réseau : les grilles d'altitude telles que
// l'IGN les a servies le jour où elles ont été figées (scripts/figer-toits.ts).
//
// Un changement de formule qui déplace un chiffre fait échouer le premier test
// de la maison concernée : c'est voulu. On regarde alors si le nouveau chiffre
// est plus juste — le banc de justesse le dit —, et l'on refige.

const DOSSIER = fileURLToPath(new URL('../fixtures/lidar', import.meta.url))

interface Jeu {
  nom: string
  description: string | null
  cleabs: string
  contour: [number, number][]
  grilles: Record<string, string>
  attendu: Record<string, unknown>
}

const jeux: Jeu[] = readdirSync(DOSSIER)
  .sort()
  .map((nom) => JSON.parse(readFileSync(join(DOSSIER, nom, 'maison.json'), 'utf8')) as Jeu)

/** Rejoue les grilles figées, et vérifie au passage que l'IGN avait servi la taille demandée. */
function rejouer(j: Jeu): LireGrille {
  return async (couche, _x0, _y0, _x1, _y1, w, h) => {
    const fichier = j.grilles[couche]
    if (!fichier) throw new Error(`grille non figée pour ${j.nom} : ${couche}`)
    const octets = readFileSync(join(DOSSIER, j.nom, fichier))
    const brut = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer
    const g = lireGeoTiff(brut)
    expect([g.w, g.h]).toEqual([w, h])
    return brut
  }
}

const sansDate = (r: ResultatToit) => {
  const reste: Record<string, unknown> = { ...r }
  delete reste.mesure_le
  return reste
}

it('les jeux d’essai sont là', () => {
  expect(jeux.map((j) => j.nom)).toEqual(
    expect.arrayContaining(['deux-pans-simple', 'croupe', 'photogrammetrie', 'abri-trop-petit']),
  )
})

describe.each(jeux)('toit réel : $nom', (j) => {
  it('rend le même résultat que le jour où il a été figé', async () => {
    expect(sansDate(await mesurerToit(j.contour, rejouer(j)))).toEqual(j.attendu)
  })

  it('tient ses invariants', async () => {
    const r = await mesurerToit(j.contour, rejouer(j))
    if (!r.couvert) {
      expect(['hors_couverture', 'trop_peu_de_toit']).toContain(r.motif)
      return
    }
    expect(r.pente).toBeGreaterThanOrEqual(0)
    expect(r.pente).toBeLessThanOrEqual(300)
    expect(r.incertitude).toBeGreaterThanOrEqual(0)
    expect(r.pixels).toBeGreaterThanOrEqual(25)
    // Les parts de versant sont des parts de pixels : chacune dans ]0, 1],
    // leur somme au plus 1, de la plus grande à la plus petite.
    const parts = r.versants.map((v) => v.part)
    for (const p of parts) expect(p).toBeGreaterThan(0)
    expect(parts.reduce((s, p) => s + p, 0)).toBeLessThanOrEqual(1 + 1e-9)
    expect([...parts].sort((a, b) => b - a)).toEqual(parts)

    if (r.hauteur_gouttiere != null && r.hauteur_faitage != null) {
      expect(r.hauteur_gouttiere).toBeLessThanOrEqual(r.hauteur_faitage)
    }
    if (!r.murs) {
      // Les murs ne se mesurent qu'au LiDAR.
      expect(r.source).toMatch(/Photogrammétrie/)
      return
    }
    // Un mur par arête du contour — celles de moins de 30 cm exceptées —, et
    // ensemble ils en font le tour.
    const poly = j.contour.map(([lon, lat]) => versLambert93(lon, lat))
    let perimetre = 0
    for (let i = 0; i < poly.length; i++) {
      const [a, b] = [poly[i], poly[(i + 1) % poly.length]]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (l >= 0.3) perimetre += l
    }
    const tour = r.murs.reduce((s, m) => s + m.longueur, 0)
    expect(Math.abs(tour - perimetre)).toBeLessThan(0.05 * r.murs.length)
    for (const m of r.murs) {
      expect(m.i).toBeGreaterThanOrEqual(0)
      expect(m.i).toBeLessThan(j.contour.length)
      expect(m.surface).toBeGreaterThanOrEqual(0)
      expect(m.valide).toBeGreaterThanOrEqual(0)
      expect(m.valide).toBeLessThanOrEqual(1)
      if (m.valide > 0) {
        expect(m.hauteur_min).toBeLessThanOrEqual(m.hauteur_moyenne + 0.05)
        expect(m.hauteur_moyenne).toBeLessThanOrEqual(m.hauteur_max + 0.05)
      }
    }
  })
})

describe('lecture des grilles', () => {
  it('lit la ligne 0 au nord, et −9999 hors couverture', () => {
    // Le jeu « photogrammétrie » a d'abord interrogé le LiDAR, absent là-bas :
    // l'IGN a répondu une grille valide, pleine de −9999.
    const j = jeux.find((x) => x.nom === 'photogrammetrie')!
    const lidar = Object.entries(j.grilles).find(([couche]) => couche.includes('LIDAR'))
    expect(lidar).toBeDefined()
    const octets = readFileSync(join(DOSSIER, j.nom, lidar![1]))
    const g = lireGeoTiff(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer)
    const invalides = g.px.reduce((n, v) => n + (v <= -9998 ? 1 : 0), 0)
    expect(invalides).toBe(g.w * g.h)
  })
})

describe('lecture pan par pan', () => {
  const lire = async (nom: string) => {
    const j = jeux.find((x) => x.nom === nom)!
    return lectureParPans((await mesurerToit(j.contour, rejouer(j))) as Toiture)
  }

  it('lit le toit à quatre pans que la règle des deux versants refusait', async () => {
    const r = await lire('croupe')
    expect(r.fiable).toBe(true)
    expect(r.pente).toBe(31)
    expect(r.pans.length).toBeGreaterThanOrEqual(4)
  })

  it('garde la pente des toits simples', async () => {
    expect((await lire('deux-pans-simple')).pente).toBe(36)
    expect((await lire('deux-pans-raides')).pente).toBe(84)
    expect((await lire('accolee')).pente).toBe(71)
  })

  it('écarte le « pan » à 154 % d’un toit à 28 % : c’est un mur', async () => {
    const r = await lire('mono-pente')
    expect(r.fiable).toBe(true)
    expect(r.pans.every((p) => p.pente <= 150)).toBe(true)
    expect(r.pente).toBeLessThan(30)
  })

  it('refuse toujours le toit vraiment découpé', async () => {
    const r = await lire('sans-pan-dominant')
    expect(r.fiable).toBe(false)
    expect(r.pente).toBeNull()
  })

  it('laisse à la photogrammétrie sa propre règle', async () => {
    const j = jeux.find((x) => x.nom === 'photogrammetrie')!
    const t = (await mesurerToit(j.contour, rejouer(j))) as Toiture
    expect(lectureParPans(t).fiable).toBe(!!t.fiable)
  })

  it('ne lit rien sur une mesure ancienne, sans pans', () => {
    expect(lectureParPans({ ok: true, couvert: true, fiable: true, pente: 40 }).pente).toBeNull()
  })
})
