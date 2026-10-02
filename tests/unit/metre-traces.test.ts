import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { versLambert93 } from '../../supabase/functions/_calcul-toit'
import { decoderNuage } from '../../supabase/functions/_nuage'
import { decoderPng, encoderPng } from '../../supabase/functions/_png'
import { cadreDeLaMaison } from '../../supabase/functions/_preuves'
import type { Releve } from '../../supabase/functions/_releve'
import { accrocher, ajusterPlan, mesurerTrace, toitNonCouvert, verifierTraces, type Contexte, type Trace } from '../../supabase/functions/_traces'
import { reliefDe, versLambert, versUV, vueAvecTraces, vueDessus, vueOblique, type Ortho, type UV } from '../../supabase/functions/_vues-ia'

// Les tracés de l'IA, mesurés dans les points LiDAR. Pour les éprouver sans IA,
// on TRACE avec les contours du relevé (Nogent 27 bis : toit à croupes, terrasse
// en hauteur) : ce que l'IA devrait tracer, et ce que le laser doit en dire.

const DOSSIER = fileURLToPath(new URL('../fixtures/copc/terrasse', import.meta.url))
const releve = JSON.parse(readFileSync(join(DOSSIER, 'releve.json'), 'utf8')) as Releve
const nuage = decoderNuage(new Uint8Array(gunzipSync(readFileSync(join(DOSSIER, 'nuage.bin.gz')))))
const cadre = cadreDeLaMaison(releve, 5, 10)
const relief = reliefDe(nuage, cadre)
const ctx: Contexte = { nuage, cadre, relief }

const enUV = (c: [number, number][]): UV[] =>
  c.map(([lon, lat]) => {
    const [x, y] = versLambert93(lon, lat)
    return versUV([x, y], cadre).map((v) => Math.round(v)) as UV
  })

const pans: Trace[] = releve.pans.map((p) => ({ id: p.id, genre: p.terrasse ? 'terrasse' : 'pan', points: enUV(p.dessin ?? p.contour), note: '' }))
const emprise: Trace = { id: 20, genre: 'emprise', points: enUV(releve.murs), note: '' }

describe('les coordonnées de l’IA', () => {
  it('reviennent au repère du laser et en repartent', () => {
    const p: [number, number] = [(cadre.bbox[0] + cadre.bbox[2]) / 2, (cadre.bbox[1] + cadre.bbox[3]) / 2]
    const [u, v] = versUV(p, cadre)
    expect(u).toBeCloseTo(500, 3)
    expect(v).toBeCloseTo(500, 3)
    const q = versLambert([u, v], cadre)
    expect(q[0]).toBeCloseTo(p[0], 6)
    expect(q[1]).toBeCloseTo(p[1], 6)
  })
})

describe('un plan ajusté dans des points', () => {
  it('retrouve la pente et écarte une cheminée', () => {
    const pts: [number, number, number][] = []
    for (let x = 0; x < 6; x += 0.4) for (let y = 0; y < 6; y += 0.4) pts.push([x, y, 5 + 0.6 * x])
    pts.push([3, 3, 9], [2, 4, 8.6])
    const f = ajusterPlan(pts)!
    expect(f.a).toBeCloseTo(0.6, 2)
    expect(Math.abs(f.b)).toBeLessThan(0.02)
    expect(f.ecart).toBeLessThan(0.05)
  })
  it('n’invente rien avec trop peu de points', () => {
    expect(ajusterPlan([[0, 0, 0], [1, 0, 0], [0, 1, 0]])).toBeNull()
  })
})

describe('mesurer les tracés du toit de Nogent 27 bis', () => {
  const mesures = new Map(pans.map((t) => [t.id, mesurerTrace(t, ctx, [])]))

  it('donne à chaque pan sa pente, à 4 points près de celle du relevé', () => {
    for (const p of releve.pans.filter((q) => !q.terrasse)) {
      const m = mesures.get(p.id)!.mesure
      if (typeof m.pente_pct !== 'number') continue
      expect(Math.abs(m.pente_pct - p.pente)).toBeLessThanOrEqual(4)
    }
  })

  it('mesure les plus grands pans à 12 % près de leur surface vraie', () => {
    for (const p of releve.pans.filter((q) => !q.terrasse && q.aireVraie > 20)) {
      const m = mesures.get(p.id)!.mesure
      expect(typeof m.aire_vraie_m2).toBe('number')
      expect(Math.abs((m.aire_vraie_m2 as number) - p.aireVraie) / p.aireVraie).toBeLessThan(0.12)
    }
  })

  it('lit la terrasse comme plus haute que le sol qui l’entoure', () => {
    const t = pans.find((x) => x.genre === 'terrasse')!
    const m = mesures.get(t.id)!.mesure
    expect(typeof m.altitude_relative_sol_m).toBe('number')
    expect(m.altitude_relative_sol_m as number).toBeGreaterThan(0.8)
  })

  it('lit la hauteur à la gouttière sous l’emprise, dans les références (7,22 à 9,5 m, au dessous de la couverture)', () => {
    const autres = pans.map((t) => ({ trace: t, mesure: mesures.get(t.id)! }))
    const m = mesurerTrace(emprise, ctx, autres).mesure
    expect(typeof m.gouttiere_m).toBe('number')
    expect(m.gouttiere_m as number).toBeGreaterThan(6.2)
    expect(m.gouttiere_m as number).toBeLessThan(9.8)
  })

  it('prévient quand un « pan » ne tient pas dans un seul plan (deux pans réunis)', () => {
    const [a, b] = pans.filter((t) => t.genre === 'pan' && mesures.get(t.id)!.mesure.aire_vraie_m2 as number > 20)
    const union: Trace = { id: 99, genre: 'pan', points: [...a.points, ...b.points], note: '' }
    const m = mesurerTrace(union, ctx, [])
    expect(m.alertes.some((x) => x.includes('scinder')) || typeof m.mesure.erreur === 'string').toBe(true)
  })

  it('refuse un tracé sans assez de points', () => {
    expect(mesurerTrace({ id: 1, genre: 'pan', points: [[10, 10], [20, 20]], note: '' }, ctx).mesure.erreur).toBeTruthy()
  })
})

describe('le toit que les pans tracés oublient', () => {
  const vrais = pans.filter((t) => t.genre === 'pan')
  it('est nul quand tous les pans sont tracés (à 15 % près)', () => {
    expect(toitNonCouvert([emprise, ...vrais], ctx).part).toBeLessThan(0.15)
  })
  it('dit où est le pan oublié', () => {
    const grand = vrais.reduce((a, b) => (mesurerTrace(a, ctx).mesure.aire_plan_m2 as number) > (mesurerTrace(b, ctx).mesure.aire_plan_m2 as number) ? a : b)
    const sans = vrais.filter((t) => t !== grand)
    const r = toitNonCouvert([emprise, ...sans], ctx)
    expect(r.part).toBeGreaterThan(0.2)
    expect(r.morceaux.length).toBeGreaterThan(0)
    // Le morceau le plus grand est dans le pan retiré.
    const [u, v] = [r.morceaux[0].u, r.morceaux[0].v]
    const P = grand.points
    let d = false
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (P[i][1] > v !== P[j][1] > v && u < ((P[j][0] - P[i][0]) * (v - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) d = !d
    expect(d).toBe(true)
  })
})

describe('les tracés entre eux', () => {
  it('signale deux pans qui se chevauchent', () => {
    const a = pans.find((t) => t.genre === 'pan')!
    const doublon: Trace = { ...a, id: 50 }
    expect(verifierTraces([emprise, a, doublon], cadre).some((x) => x.includes('chevauchent'))).toBe(true)
  })
  it('signale l’absence d’emprise', () => {
    expect(verifierTraces(pans.filter((t) => t.genre === 'pan'), cadre).some((x) => x.includes('Aucune emprise'))).toBe(true)
  })
  it('accroche deux coins à moins de 50 cm', () => {
    const A: Trace = { id: 1, genre: 'pan', points: [[100, 100], [300, 100], [300, 300]], note: '' }
    const B: Trace = { id: 2, genre: 'pan', points: [[302, 101], [500, 100], [500, 300]], note: '' }
    const [a, b] = accrocher([A, B], cadre)
    expect(a.points[1]).toEqual(b.points[0])
  })
})

describe('les images de l’IA', () => {
  const ortho: Ortho = (() => {
    const largeur = cadre.largeur, hauteur = cadre.hauteur
    const rgba = new Uint8Array(largeur * hauteur * 4)
    for (let i = 0; i < largeur * hauteur; i++) rgba.set([90 + (i % 50), 120, 80, 255], i * 4)
    return { largeur, hauteur, rgba, bbox: cadre.bbox, resolutionCm: 5 }
  })()

  it('décodent ce que l’encodeur écrit', async () => {
    const png = await encoderPng(ortho.rgba, ortho.largeur, ortho.hauteur)
    const img = await decoderPng(png)
    expect(img.largeur).toBe(ortho.largeur)
    expect(Array.from(img.rgba.slice(0, 8))).toEqual(Array.from(ortho.rgba.slice(0, 8)))
  })

  it('la vue de dessus a la taille de la photo, avec sa grille', async () => {
    const png = await vueDessus(ortho)
    const dv = new DataView(png.buffer, png.byteOffset)
    expect(dv.getUint32(16)).toBe(ortho.largeur)
    expect(dv.getUint32(20)).toBe(ortho.hauteur)
  })

  it('les quatre vues obliques se dessinent', async () => {
    for (const v of ['nord', 'sud', 'est', 'ouest'] as const) {
      const png = await vueOblique(relief, ortho, v, 640)
      expect(png.length).toBeGreaterThan(3000)
    }
  })

  it('les tracés se superposent à la photo', async () => {
    const png = await vueAvecTraces(ortho, [{ id: 3, points: emprise.points, ferme: true, couleur: [220, 38, 38] }])
    expect(png.length).toBeGreaterThan(3000)
  })
})

// La boucle du métreur, avec un FAUX modèle qui suit un scénario : il regarde,
// trace l'emprise, un pan et une terrasse, lit les chiffres, superpose, termine.
import { compteRendu, metreur, type Bloc, type Reponse } from '../../supabase/functions/_metreur-ia'

describe('la boucle du métreur IA', () => {
  const ortho: Ortho = (() => {
    const largeur = cadre.largeur, hauteur = cadre.hauteur
    const rgba = new Uint8Array(largeur * hauteur * 4).fill(120)
    return { largeur, hauteur, rgba, bbox: cadre.bbox, resolutionCm: 5 }
  })()
  const png = async () => new Uint8Array([1, 2, 3, 4])
  const appel = (id: string, name: string, input: Record<string, unknown>): Bloc => ({ type: 'tool_use', id, name, input })
  const grandPan = pans.find((t) => t.genre === 'pan' && t.id === 1)!
  const terrasse = pans.find((t) => t.genre === 'terrasse')!

  function fauxModele(scenario: Bloc[][]) {
    let tour = 0
    const vus: unknown[] = []
    return {
      vus,
      creer: async (p: { messages: unknown[] }): Promise<Reponse> => {
        vus.push(p.messages.length)
        const content = scenario[tour++] ?? [{ type: 'text', text: 'fini' }]
        return { content, stop_reason: 'tool_use', model: 'faux', usage: { input_tokens: 100, output_tokens: 20 } }
      },
    }
  }

  it('trace, reçoit les mesures du laser, et rend ses tracés mesurés', async () => {
    const faux = fauxModele([
      [appel('a', 'voir', { vue: 'sud' })],
      [appel('b', 'tracer', { objets: [{ id: 20, genre: 'emprise', points: emprise.points, note: 'murs' }, { id: 1, genre: 'pan', points: grandPan.points, note: 'pan sud' }, { id: 5, genre: 'terrasse', points: terrasse.points, note: 'dalle' }] })],
      [appel('c', 'superposer', {})],
      [appel('d', 'terminer', { resume: 'Maison à croupes et terrasse.', doutes: ['arbre au nord'] })],
    ])
    const r = await metreur({ creer: faux.creer as never, image: png, ctx, ortho })
    expect(r.terminee).toBe(true)
    expect(r.tours).toBe(4)
    expect(r.traces.map((t) => t.genre).sort()).toEqual(['emprise', 'pan', 'terrasse'])
    const pan = r.mesures.find((m) => m.id === 1)!.mesure
    expect(typeof pan.pente_pct).toBe('number')
    expect(r.mesures.find((m) => m.genre === 'emprise')!.mesure.gouttiere_m).toBeGreaterThan(6)
    expect(r.doutes).toEqual(['arbre au nord'])
    expect(r.usage).toEqual({ entree: 400, sortie: 80 })
    expect(r.modele).toBe('faux')
  })

  it('remplace un tracé qui porte le même numéro, et supprime à la demande', async () => {
    const faux = fauxModele([
      [appel('a', 'tracer', { objets: [{ id: 1, genre: 'pan', points: grandPan.points, note: '' }] })],
      [appel('b', 'tracer', { objets: [{ id: 1, genre: 'pan', points: grandPan.points.slice(0, 3), note: 'retracé' }] })],
      [appel('c', 'supprimer', { ids: [1] })],
      [appel('d', 'terminer', { resume: '', doutes: [] })],
    ])
    const r = await metreur({ creer: faux.creer as never, image: png, ctx, ortho })
    expect(r.traces).toHaveLength(0)
  })

  it('refuse les tracés mal formés sans planter, et le dit au modèle', async () => {
    let reponseOutil = ''
    const scenario: Bloc[][] = [
      [appel('a', 'tracer', { objets: [{ id: 0, genre: 'pan', points: [[1, 1]], note: '' }, { id: 2, genre: 'piscine', points: [[1, 1], [2, 2], [3, 3]], note: '' }] })],
      [appel('b', 'terminer', { resume: '', doutes: [] })],
    ]
    let tour = 0
    const r = await metreur({
      creer: (async (p: { messages: { content: unknown }[] }) => {
        if (tour === 1) reponseOutil = JSON.stringify(p.messages[p.messages.length - 1].content)
        return { content: scenario[tour++], stop_reason: 'tool_use' }
      }) as never,
      image: png,
      ctx,
      ortho,
    })
    expect(r.traces).toHaveLength(0)
    expect(reponseOutil).toContain('REFUSÉS')
    expect(reponseOutil).toContain('inconnu')
  })

  it('s’arrête au plafond de tours, même sans « terminer »', async () => {
    const faux = fauxModele(Array.from({ length: 20 }, (_, i) => [appel(`v${i}`, 'voir', { vue: 'nord' })]))
    const r = await metreur({ creer: faux.creer as never, image: png, ctx, ortho, maxTours: 3 })
    expect(r.tours).toBe(3)
    expect(r.terminee).toBe(false)
  })

  it('garde les tracés de départ (ceux de l’artisan) et les complète', async () => {
    const faux = fauxModele([[appel('a', 'terminer', { resume: '', doutes: [] })]])
    const r = await metreur({ creer: faux.creer as never, image: png, ctx, ortho, depart: [emprise] })
    expect(r.traces.map((t) => t.id)).toEqual([20])
    expect(r.mesures[0].mesure.perimetre_m).toBeGreaterThan(30)
  })

  it('le compte rendu dit les alertes', () => {
    const t = compteRendu([{ id: 4, genre: 'pan', mesure: { pente_pct: 60 }, alertes: ['scinder'] }], ['Les pans 1 et 2 se chevauchent'])
    expect(t).toContain('pente pct : 60')
    expect(t).toContain('ALERTES : scinder')
    expect(t).toContain('CONTRÔLE D’ENSEMBLE')
  })
})
