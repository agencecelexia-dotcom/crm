import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { modeleDuReleve, verifierModele } from '../../supabase/functions/_modele3d'
import { niveauxDuTerrain } from '../../supabase/functions/_niveaux'
import { decoderNuage } from '../../supabase/functions/_nuage'
import { encoderPng } from '../../supabase/functions/_png'
import { cadreDeLaMaison, carteDesHauteurs } from '../../supabase/functions/_preuves'
import type { Releve } from '../../supabase/functions/_releve'
import { consigneScene, GENRES_VOLUME, SCHEMA_SCENE, validerScene, type SceneIA } from '../../supabase/functions/_scene-ia'

// « Mesurer avec l'IA » : ce que l'IA lit d'une maison. Les nombres viennent du
// LiDAR ; l'IA nomme et rattache. Ces tests tiennent la frontière : niveaux du
// terrain lus dans les points, scène de l'IA confrontée aux mesures, aucune
// valeur libre dans son schéma.

const DOSSIER = fileURLToPath(new URL('../fixtures/copc/terrasse', import.meta.url))
const releve = JSON.parse(readFileSync(join(DOSSIER, 'releve.json'), 'utf8')) as Releve
const nuage = decoderNuage(new Uint8Array(gunzipSync(readFileSync(join(DOSSIER, 'nuage.bin.gz')))))
const niveaux = niveauxDuTerrain(nuage, releve)

describe('les niveaux du terrain (Nogent 27 bis : terrasse en hauteur, jardin, cour)', () => {
  it('lit la dalle de la terrasse comme un niveau, au-dessus du sol voisin', () => {
    const dalle = niveaux.niveaux.find((n) => n.origine === 'dalle')!
    expect(dalle).toBeDefined()
    const sols = niveaux.niveaux.filter((n) => n.origine === 'sol' && n.distanceMaison < 3)
    // La terrasse est plus haute que le jardin qui la longe : c'est ce qui fait la hauteur du mur.
    expect(sols.some((s) => dalle.z - s.z > 1)).toBe(true)
  })

  it('relie la terrasse au sol par une transition dont le dénivelé est mesuré', () => {
    const t = niveaux.transitions.find((x) => x.genre === 'a_voir')!
    expect(t).toBeDefined()
    expect(t.denivele).toBeGreaterThan(1.2)
    expect(t.denivele).toBeLessThan(2.2)
    // Sa descente part de la maison vers l'extérieur (au sud de la terrasse).
    expect(Math.hypot(t.sens[0], t.sens[1])).toBeCloseTo(1, 1)
  })

  it('dit quel niveau est au pied des murs', () => {
    expect(Object.keys(niveaux.auPied).length).toBeGreaterThanOrEqual(2)
  })

  it('ne garde que des niveaux d’au moins 2 m²', () => {
    for (const n of niveaux.niveaux) expect(n.aire).toBeGreaterThanOrEqual(2)
  })
})

describe('le schéma de la scène : aucune valeur libre', () => {
  it('n’a que des numéros, des énumérations et du texte — jamais un nombre à mesurer', () => {
    const types: string[] = []
    const marcher = (o: unknown) => {
      if (Array.isArray(o)) return o.forEach(marcher)
      if (o && typeof o === 'object') {
        const t = (o as { type?: unknown }).type
        if (typeof t === 'string') types.push(t)
        Object.values(o).forEach(marcher)
      }
    }
    marcher(SCHEMA_SCENE)
    expect(types).not.toContain('number')
    // Les entiers sont des références (pan, niveau, transition) que `validerScene` vérifie.
    expect(new Set(types)).toEqual(new Set(['object', 'string', 'boolean', 'array', 'integer', 'null']))
  })

  it('n’a pas de champ dont le nom parle d’une mesure', () => {
    const noms: string[] = []
    const marcher = (o: unknown) => {
      if (Array.isArray(o)) return o.forEach(marcher)
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'properties') noms.push(...Object.keys(v as object))
          marcher(v)
        }
      }
    }
    marcher(SCHEMA_SCENE)
    for (const n of noms) expect(n).not.toMatch(/hauteur|altitude|surface|pente|longueur|largeur|z$/i)
  })

  it('la consigne liste ce que le relevé a mesuré, et interdit d’inventer un nombre', () => {
    const c = consigneScene(releve, niveaux, '27 bis rue François Rolland', 5)
    expect(c).toContain('pan 5 : DALLE PLATE')
    expect(c).toContain('transition 0')
    expect(c).toMatch(/Aucun nombre à toi/)
  })
})

const sceneSaine = (): SceneIA => ({
  emprise: 'oui',
  mitoyenne: false,
  volumes: [
    { ref: 'v1', genre: 'maison', niveau: 0, pans: [1, 2, 3, 4, 6, 7], remarque: 'toit à croupes', confiance: 'haute' },
    { ref: 'v2', genre: 'terrasse_haute', niveau: niveaux.niveaux.find((n) => n.origine === 'dalle')!.id, pans: [5], remarque: 'dalle sans toit', confiance: 'moyenne' },
  ],
  escaliers: [{ transition: 0, remarque: 'marches visibles' }],
  doutes: [],
  confiance: 'moyenne',
})

describe('validerScene : la mesure gagne', () => {
  it('laisse passer une scène cohérente', () => {
    const { scene, verif } = validerScene(sceneSaine(), releve, niveaux)
    expect(verif.corrections).toEqual([])
    expect(verif.a_verifier).toEqual([])
    expect(scene.volumes).toHaveLength(2)
  })

  it('retire un pan, un niveau ou une transition qui n’existent pas', () => {
    const s = sceneSaine()
    s.volumes[0].pans.push(99)
    s.volumes[0].niveau = 42
    s.escaliers.push({ transition: 7, remarque: 'inventé' })
    const { scene, verif } = validerScene(s, releve, niveaux)
    expect(scene.volumes[0].pans).not.toContain(99)
    expect(scene.volumes[0].niveau).toBeNull()
    expect(scene.escaliers).toHaveLength(1)
    expect(verif.corrections).toHaveLength(3)
  })

  it('laisse un pan au premier volume qui le revendique', () => {
    const s = sceneSaine()
    s.volumes[1].pans.push(1)
    const { scene, verif } = validerScene(s, releve, niveaux)
    expect(scene.volumes[1].pans).toEqual([5])
    expect(verif.corrections.some((c) => c.includes('déjà pris'))).toBe(true)
  })

  it('signale une « terrasse » couverte de pans en pente', () => {
    const s = sceneSaine()
    s.volumes[1].pans = [5, 2]
    s.volumes[0].pans = [1, 3, 4, 6, 7]
    const { verif } = validerScene(s, releve, niveaux)
    expect(verif.a_verifier.some((a) => a.includes('couverte de pans en pente'))).toBe(true)
  })

  it('dit les pans laissés sans volume et l’absence de maison', () => {
    const s = sceneSaine()
    s.volumes = [{ ref: 'v1', genre: 'jardin', niveau: 0, pans: [], remarque: '', confiance: 'basse' }]
    const { verif } = validerScene(s, releve, niveaux)
    expect(verif.a_verifier.some((a) => a.includes('aucun volume'))).toBe(true)
    expect(verif.a_verifier.some((a) => a.includes('aucun volume comme la maison'))).toBe(true)
  })

  it('dit quand le contour est jugé faux', () => {
    const s = sceneSaine()
    s.emprise = 'non'
    expect(validerScene(s, releve, niveaux).verif.a_verifier.some((a) => a.includes('faux'))).toBe(true)
  })

  it('ne connaît que les genres du schéma', () => {
    expect(GENRES_VOLUME).toContain('terrasse_haute')
    expect(GENRES_VOLUME).toContain('escalier')
  })
})

describe('le modèle 3D avec la lecture de l’IA', () => {
  const { scene } = validerScene(sceneSaine(), releve, niveaux)
  const m = modeleDuReleve(releve, [], { scene, niveaux })

  it('nomme les pans d’après leur volume', () => {
    expect(m.faces.find((f) => f.type === 'pan' && f.ref === '5')?.genre).toBe('Terrasse haute')
    expect(m.faces.find((f) => f.type === 'pan' && f.ref === '1')?.genre).toBe('Maison')
  })

  it('pose des marches entre les deux niveaux, d’après le dénivelé mesuré (≈ 17 cm chacune)', () => {
    const marches = m.faces.filter((f) => f.type === 'marche' && !f.ref.endsWith('h'))
    const t = niveaux.transitions[0]
    expect(marches.length).toBe(Math.max(2, Math.round(t.denivele / 0.17)))
    const zs = marches.map((f) => f.sommets[0][2])
    // Elles descendent de la dalle vers le sol.
    expect(zs[0]).toBeGreaterThan(zs[zs.length - 1])
    expect(zs[0]).toBeLessThan(niveaux.niveaux[niveaux.transitions[0].entre[1]].z)
    expect(zs[zs.length - 1]).toBeGreaterThanOrEqual(niveaux.niveaux[niveaux.transitions[0].entre[0]].z - 0.01)
  })

  it('reste sans défaut', () => {
    expect(verifierModele(m, releve)).toEqual([])
  })

  it('sans lecture de l’IA, le modèle est celui d’avant', () => {
    expect(modeleDuReleve(releve).faces.filter((f) => f.type === 'marche')).toHaveLength(0)
  })
})

describe('les images que l’IA lit', () => {
  it('le PNG encodé se relit : signature, taille, pixels', async () => {
    const rgba = new Uint8Array(4 * 3 * 2)
    for (let i = 0; i < rgba.length; i += 4) rgba.set([10 * i, 20, 30, 255], i)
    const png = await encoderPng(rgba, 3, 2)
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const dv = new DataView(png.buffer, png.byteOffset)
    expect(dv.getUint32(16)).toBe(3)
    expect(dv.getUint32(20)).toBe(2)
    // Le bloc IDAT décompressé : 2 lignes de (1 octet de filtre + 12 octets de pixels).
    const idat = png.indexOf(0x49, 33)
    const taille = dv.getUint32(idat - 4)
    const brut = inflateSync(png.slice(idat + 4, idat + 4 + taille))
    expect(brut.length).toBe(2 * (1 + 12))
    expect(Array.from(brut.slice(1, 5))).toEqual([0, 20, 30, 255])
  })

  it('la carte des hauteurs a le cadrage de la photo et un contenu', async () => {
    const cadre = cadreDeLaMaison(releve, 5)
    const png = await carteDesHauteurs(nuage, releve, niveaux, cadre)
    const dv = new DataView(png.buffer, png.byteOffset)
    expect(dv.getUint32(16)).toBe(cadre.largeur)
    expect(dv.getUint32(20)).toBe(cadre.hauteur)
    expect(png.length).toBeGreaterThan(5000)
  })
})
