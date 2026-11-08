import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
import { envoyerDevisAuClient, envoyerDevisPdfEmail } from '@/features/devis/use-devis'

class LecteurFictif {
  result = 'data:application/pdf;base64,UERGIGZpY3RpZg=='
  onloadend: (() => void) | null = null
  readAsDataURL() { this.onloadend?.() }
}

afterEach(() => vi.unstubAllGlobals())

describe('Accusé de transmission des devis, sans aucun réseau réel', () => {
  it.each([400, 429, 500, 503])('un HTTP %s ne peut pas devenir un envoi réussi', async (status) => {
    vi.stubGlobal('FileReader', LecteurFictif)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
    await expect(envoyerDevisAuClient({ email: 'client@example.test', numero: 'DEV-FICTIF', sujet: 'Test', html: '<p>Fictif</p>', pdf: new Blob(['Fictif']) })).rejects.toThrow()
  })

  it('refuse aussi une réponse opaque sans confirmation serveur', async () => {
    vi.stubGlobal('FileReader', LecteurFictif)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 0, type: 'opaque' }))
    await expect(envoyerDevisPdfEmail({ email: 'artisan@example.test', numero: 'DEV-FICTIF', pdf: new Blob(['Fictif']) })).rejects.toThrow()
  })

  it('échappe le nom du client dans le mail récapitulatif de l’artisan', async () => {
    vi.stubGlobal('FileReader', LecteurFictif)
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await envoyerDevisPdfEmail({ email: 'artisan@example.test', numero: 'DEV-FICTIF', client_nom: '<img src=x onerror=alert(1)>', pdf: new Blob(['Fictif']) })
    const payload = JSON.parse(fetch.mock.calls[0][1].body) as { html: string }
    expect(payload.html).not.toContain('<img')
    expect(payload.html).toContain('&lt;img')
    expect(fetch.mock.calls[0][1].mode).not.toBe('no-cors')
  })
})

import { pdfDevisAutorise, priseEnChargeConfirmee } from '../../supabase/functions/_envoi-devis'

describe('Contrat serveur et source PDF du relais', () => {
  const cle = 'tentative-fictive-unique'
  it.each([null, {}, { ok: true }, { accepted: true }, { ok: true, accepted: true, idempotency_key: 'autre' }])('refuse un accusé incomplet ou qui ne correspond pas à la tentative : %j', (r) => {
    expect(priseEnChargeConfirmee(r, cle)).toBe(false)
  })
  it('accepte uniquement un accusé explicite et corrélé', () => {
    expect(priseEnChargeConfirmee({ ok: true, accepted: true, idempotency_key: cle }, cle)).toBe(true)
  })
  const origine = 'https://crm-test.supabase.co'
  const chemin = `/storage/v1/object/public/devis/genere/${'a'.repeat(64)}/DEV-FICTIF.pdf`
  it('autorise le PDF du bucket attendu', () => expect(pdfDevisAutorise(origine + chemin, origine)).toBe(true))
  it.each(['https://externe.example.test', 'http://crm-test.supabase.co', 'https://crm-test.supabase.co.externe.test'])('refuse une origine PDF détournée %s', (host) => {
    expect(pdfDevisAutorise(host + chemin, origine)).toBe(false)
  })
  it('refuse un autre bucket et une URL avec identifiants', () => {
    expect(pdfDevisAutorise(origine + '/storage/v1/object/public/autre/document.pdf', origine)).toBe(false)
    expect(pdfDevisAutorise('https://user:password@crm-test.supabase.co' + chemin, origine)).toBe(false)
  })
})

import { readFileSync } from 'node:fs'

describe('Workflow préparé sans exécution Gmail', () => {
  const workflow = JSON.parse(readFileSync('automation/n8n/devis-envoi-confirme.template.json', 'utf8')) as {
    active: boolean
    nodes: { name: string; type: string; parameters: { jsCode?: string; authentication?: string }; retryOnFail?: boolean }[]
  }
  const code = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.code')!.parameters.jsCode!
  const executer = (body: Record<string, unknown>) => new Function('$input', 'Buffer', code)({ first: () => ({ json: { body } }) }, Buffer)
  const valide = { event: 'envoyer_devis_client', email: 'fictif@example.test', idempotency_key: '00000000-0000-0000-0000-000000000001', pdf_base64: Buffer.from('%PDF-1.4 fictif').toString('base64'), html: '<p>Fictif</p>', subject: 'Devis fictif' }
  it('est désactivé, exige un secret et ne relance pas automatiquement Gmail', () => {
    expect(workflow.active).toBe(false)
    expect(workflow.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')!.parameters.authentication).toBe('headerAuth')
    expect(workflow.nodes.find((n) => n.type === 'n8n-nodes-base.gmail')!.retryOnFail).toBe(false)
  })
  it('prépare la pièce jointe fictive sans réseau', () => {
    const items = executer(valide)
    expect(items[0].binary.pdf.mimeType).toBe('application/pdf')
    expect(items[0].json.idempotency_key).toBe(valide.idempotency_key)
  })
  it.each([{ email: 'un@example.test,deux@example.test' }, { pdf_base64: Buffer.from('pas un PDF').toString('base64') }, { idempotency_key: '' }])('refuse le contenu invalide %j', (invalide) => {
    expect(() => executer({ ...valide, ...invalide })).toThrow()
  })
})
