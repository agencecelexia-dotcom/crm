import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mesurer: vi.fn(), parCleabs: vi.fn() }))
vi.mock('../../supabase/functions/_calcul-toit.ts', () => ({ mesurerToit: mocks.mesurer, VERSION_TOITURE: 4 }))
vi.mock('../../supabase/functions/_batiment.ts', () => ({ parCleabs: mocks.parCleabs }))

const cleabs = 'BATIMENT0000002209748162'
const contourClient = [[4.87, 45.81], [4.871, 45.81], [4.871, 45.811]]
const contourIgn = [[4.8703553, 45.81760704], [4.87041973, 45.81764561], [4.87052124, 45.81756196], [4.8704581, 45.81752337]]
let handler: (r: Request) => Promise<Response>
let tokenValide: boolean
let cache: Record<string, unknown>
let appels: { nom: string; body: Record<string, unknown> }[]

beforeEach(async () => {
  vi.resetModules()
  mocks.mesurer.mockReset().mockResolvedValue({ ok: true, couvert: false, motif: 'hors_couverture' })
  mocks.parCleabs.mockReset().mockResolvedValue([{ cleabs, contour: contourIgn }])
  tokenValide = true; cache = { trouvee: false }; appels = []
  vi.stubGlobal('Deno', { env: { get: (nom: string) => nom === 'SUPABASE_URL' ? 'https://supabase.test' : 'fictif' }, serve: (h: typeof handler) => { handler = h } })
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const nom = url.split('/').at(-1)!
    appels.push({ nom, body: JSON.parse(String(options.body)) })
    return Response.json(nom === 'token_artisan_valide' ? tokenValide : nom === 'toiture_by_token' ? cache : true)
  }))
  await import('../../supabase/functions/toiture-lidar/index.ts')
})
afterEach(() => vi.unstubAllGlobals())
const requete = (extra: Record<string, unknown> = {}) => handler(new Request('https://edge.test/toiture-lidar', { method: 'POST', body: JSON.stringify({ token: 'token-fictif', cleabs, contour: contourClient, ...extra }) }))

describe('cache de toiture partagé : le bâtiment vient de la BD TOPO', () => {
  it('refuse le jeton invalide avant toute lecture ou mesure IGN', async () => {
    tokenValide = false
    expect((await requete()).status).toBe(403)
    expect(mocks.parCleabs).not.toHaveBeenCalled()
    expect(mocks.mesurer).not.toHaveBeenCalled()
  })

  it('mesure le contour IGN du cleabs, même si le navigateur en fournit un autre', async () => {
    expect((await requete()).status).toBe(200)
    expect(mocks.parCleabs).toHaveBeenCalledWith([cleabs], expect.any(Array))
    expect(mocks.mesurer).toHaveBeenCalledWith(contourIgn)
    expect(appels.find((a) => a.nom === 'enregistrer_toiture')?.body).toMatchObject({ p_cleabs: cleabs, p_version: 4 })
  })

  it('n’écrit rien quand la BD TOPO ne retrouve pas cet identifiant', async () => {
    mocks.parCleabs.mockResolvedValue([{ cleabs: 'BATIMENT0000000000000000', contour: contourIgn }])
    expect((await requete()).status).toBe(404)
    expect(mocks.mesurer).not.toHaveBeenCalled()
    expect(appels.some((a) => a.nom === 'enregistrer_toiture')).toBe(false)
  })

  it('ignore le cache version3 créé à partir d’un contour client', async () => {
    cache = { trouvee: true, couvert: true, version: 3, pente: 99 }
    await requete()
    expect(mocks.mesurer).toHaveBeenCalledWith(contourIgn)
  })

  it('sert le cache version4 sans nouveaux appels IGN', async () => {
    cache = { trouvee: true, couvert: true, version: 4, pente: 35, motif: null }
    expect(await (await requete()).json()).toMatchObject({ ok: true, cache: true, pente: 35 })
    expect(mocks.parCleabs).not.toHaveBeenCalled()
    expect(mocks.mesurer).not.toHaveBeenCalled()
  })

  it('garde la mesure sans identifiant comme calcul privé, sans cache partagé', async () => {
    await requete({ cleabs: null })
    expect(mocks.mesurer).toHaveBeenCalledWith(contourClient)
    expect(mocks.parCleabs).not.toHaveBeenCalled()
    expect(appels.some((a) => a.nom === 'enregistrer_toiture')).toBe(false)
  })
})
