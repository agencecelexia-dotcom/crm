import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lireJson } from '../../supabase/functions/_batiment'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

/** Le vrai fetch interrompt également la lecture du corps lorsque son signal expire. */
function corpsBloque(signal: AbortSignal) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partiel":'))
      signal.addEventListener('abort', () => controller.error(new DOMException('Lecture interrompue', 'AbortError')), { once: true })
    },
  }), { status: 200 })
}

describe('lireJson : délai de la réponse entière', () => {
  it('interrompt un corps qui reste bloqué après les en-têtes HTTP200', async () => {
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      signal = options.signal
      return Promise.resolve(corpsBloque(signal))
    }))
    const resultat = lireJson('https://source.example/test', 1, 100).catch((e) => e)
    await vi.advanceTimersByTimeAsync(99)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(700)
    expect(await resultat).toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('réessaie après expiration du corps puis rend le JSON complet', async () => {
    const signaux: AbortSignal[] = []
    const fetch = vi.fn((_url, options) => {
      signaux.push(options.signal)
      return Promise.resolve(signaux.length === 1 ? corpsBloque(options.signal) : Response.json({ features: [] }))
    })
    vi.stubGlobal('fetch', fetch)
    const resultat = lireJson('https://source.example/test', 2, 100)
    await vi.advanceTimersByTimeAsync(800)
    expect(await resultat).toEqual({ features: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(signaux.map((signal) => signal.aborted)).toEqual([true, false])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('nettoie le délai même si la connexion échoue avant les en-têtes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connexion_interrompue')))
    const resultat = lireJson('https://source.example/test', 1, 8000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(700)
    expect(await resultat).toMatchObject({ message: 'connexion_interrompue' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ne garde pas de délai après un JSON reçu et refuse un corps vide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(new Response('')))
    expect(await lireJson('https://source.example/test', 1)).toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
    const vide = lireJson('https://source.example/test', 1).catch((e) => e)
    await vi.advanceTimersByTimeAsync(700)
    expect(await vide).toMatchObject({ message: 'reponse_vide' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
