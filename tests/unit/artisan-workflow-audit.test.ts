import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = JSON.parse(readFileSync(new URL('../../automation/n8n/devis-envoi-confirme.template.json', import.meta.url), 'utf8')) as {
  active: boolean
  nodes: { name: string; parameters: Record<string, string>; retryOnFail?: boolean }[]
  connections: Record<string, { main: { node: string }[][] }>
}
const noeud = (name: string) => workflow.nodes.find(n => n.name === name)!
const pdf = Buffer.from('%PDF-1.4\nFichier fictif').toString('base64')
const demande = { event: 'envoyer_devis_client', email: 'test@example.test', idempotency_key: '00000000-0000-4000-8000-000000000001', pdf_base64: pdf, html: '<p>Devis fictif</p>', subject: 'Test local', filename: 'devis-test.pdf' }
const valider = (body: unknown) => new Function('$input', 'Buffer', noeud('Valider le devis').parameters.jsCode)({ first: () => ({ json: { body } }) }, Buffer)

describe('workflow devis, sans connexion à Gmail ni n8n', () => {
  it('valide et conserve destinataire, pièce et clé sans aucun envoi', () => {
    const sortie = valider(demande)
    expect(sortie[0].json.email).toBe('test@example.test')
    expect(sortie[0].json.idempotency_key).toBe(demande.idempotency_key)
    expect(sortie[0].binary.pdf.data).toBe(pdf)
  })
  it.each([
    { ...demande, email: 'a@example.test,b@example.test' },
    { ...demande, pdf_base64: Buffer.from('pas un PDF').toString('base64') },
    { ...demande, idempotency_key: 'clé invalide' },
    { ...demande, event: 'autre_evenement' },
  ])('bloque les demandes invalides avant la messagerie', p => expect(() => valider(p)).toThrow())
  it('bloque le workflow si la clé a déjà été consommée', () => {
    const code = new Function('$input', '$', noeud('Vérifier la remise unique').parameters.jsCode)
    expect(() => code({ first: () => ({ json: { ok: false } }) }, () => ({ first: () => valider(demande)[0] }))).toThrow('clé déjà utilisée')
    const original = valider(demande)[0]
    expect(code({ first: () => ({ json: { ok: true } }) }, () => ({ first: () => original }))[0]).toEqual(original)
  })
  it('place la prise durable avant Gmail et désactive les renvois automatiques', () => {
    expect(workflow.active).toBe(false)
    expect(workflow.connections['Valider le devis'].main[0][0].node).toBe('Réserver la remise unique')
    expect(workflow.connections['Réserver la remise unique'].main[0][0].node).toBe('Vérifier la remise unique')
    expect(workflow.connections['Vérifier la remise unique'].main[0][0].node).toBe('Remettre à Gmail')
    expect(noeud('Remettre à Gmail').retryOnFail).toBe(false)
    expect(noeud('Recevoir le devis').parameters.authentication).toBe('headerAuth')
  })
})
