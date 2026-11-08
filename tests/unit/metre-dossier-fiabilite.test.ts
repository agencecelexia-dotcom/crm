import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reporterAuDossier } from '../../supabase/functions/_dossier-serveur'
import type { Releve } from '../../supabase/functions/_releve'

const releve = JSON.parse(readFileSync(new URL('../fixtures/copc/deux-pans-simple/releve.json', import.meta.url), 'utf8')) as Releve
const cleabs = 'BATIMENT0000002209748162'
const projet = { id: '00000000-0000-4000-8000-000000000123', metier: 'Façade / Ravalement', metiers: ['Couverture'] }
let photosEnPanne: boolean
let ecritures: { url: URL; method: string; headers: Headers; body: Record<string, unknown> | Record<string, unknown>[] }[]

beforeEach(() => {
  photosEnPanne = false; ecritures = []
  vi.stubGlobal('Deno', { env: { get: (nom: string) => nom === 'SUPABASE_URL' ? 'https://supabase.test' : 'fictif' } })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/automatisation_active')) return Response.json(true)
    if (url.pathname.endsWith('/projets')) return Response.json([projet])
    if (url.pathname.endsWith('/facade_photo')) return photosEnPanne ? new Response('indisponible', { status: 503 }) : Response.json([])
    if (url.pathname.endsWith('/releve_batiment')) return Response.json([{ materiaux: null }])
    if (url.pathname.endsWith('/metrage_chantier')) {
      if (!init?.method || init.method === 'GET') return Response.json([])
      ecritures.push({ url, method: init.method, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) })
      return new Response(null, { status: 204 })
    }
    throw new Error(`appel_non_prevu:${url.pathname}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('report au dossier après recalcul complet', () => {
  it('invalide uniquement les anciennes mesures automatiques devenues absentes', async () => {
    await reporterAuDossier(cleabs, releve)
    const retirees = ecritures.filter((e) => !Array.isArray(e.body) && e.body.valeur_mesuree === null)
    expect(retirees).toHaveLength(1)
    const retrait = retirees[0]
    expect(retrait.method).toBe('PATCH')
    expect(retrait.url.searchParams.get('projet_id')).toBe(`eq.${projet.id}`)
    expect(retrait.url.searchParams.get('mesure_source')).toBe('in.(lidar,photogrammetrie,ia_photo)')
    expect(retrait.url.searchParams.get('cle')).toContain('ouvertures_surface')
    expect(retrait.url.searchParams.get('cle')).not.toContain('toit_surface')
    expect(Object.keys(retrait.body).sort()).toEqual(['valeur_mesuree', 'mesure_source', 'mesure_precision', 'mesure_detail', 'mesuree_le'].sort())
  })

  it('ne prend pas une panne des photos pour une absence et n’écrit rien', async () => {
    photosEnPanne = true
    await expect(reporterAuDossier(cleabs, releve)).rejects.toThrow('dossier_lecture_503')
    expect(ecritures).toEqual([])
  })

  it('ne remplace pas une mesure dessinée lors d’un conflit d’insertion', async () => {
    await reporterAuDossier(cleabs, releve)
    const insertions = ecritures.filter((e) => e.method === 'POST')
    expect(insertions).toHaveLength(1)
    expect(insertions[0].headers.get('prefer')).toContain('resolution=ignore-duplicates')
    const misesAJour = ecritures.filter((e) => e.method === 'PATCH' && !Array.isArray(e.body) && e.body.valeur_mesuree !== null)
    expect(misesAJour.length).toBeGreaterThan(0)
    for (const e of misesAJour) {
      expect(e.url.searchParams.get('or')).toBe('(mesure_source.is.null,mesure_source.in.(lidar,photogrammetrie,ia_photo))')
      expect(e.url.searchParams.get('unite')).toMatch(/^eq\./)
      expect(e.body).not.toHaveProperty('valeur_retenue')
      expect(e.body).not.toHaveProperty('statut')
      expect(e.body).not.toHaveProperty('unite')
    }
  })

  it('ne recalcule pas le dossier à partir d’un relevé peu fiable', async () => {
    expect(await reporterAuDossier(cleabs, { ...releve, confiance: 'basse' })).toBe(0)
    expect(ecritures).toEqual([])
  })
})
