import { describe, expect, it, vi } from 'vitest'
import { clientN8n, listerAutomatisations, modifierAutomatisation, resumerWorkflow, type MemoireN8n, type WorkflowN8n } from '../../supabase/functions/_automatisations-n8n'

const workflow = (props: Partial<WorkflowN8n> = {}): WorkflowN8n => ({ id: 'test', name: 'Workflow fictif', active: true, activeVersionId: 'publie-v1', versionId: 'brouillon-v2', updatedAt: '2026-11-14T10:00:00Z', nodes: [{ type: 'n8n-nodes-base.webhook' }], ...props })
function banc(initial = workflow()) {
  let etat = initial
  let version: string | null = null
  const memoire: MemoireN8n = {
    verrouiller: vi.fn(async () => true), liberer: vi.fn(async () => {}),
    version: vi.fn(async () => version), memoriser: vi.fn(async (_, v) => { version = v }), journal: vi.fn(async () => {}),
  }
  const n8n = vi.fn(async (path: string, method?: string, body?: unknown) => {
    if (method === 'POST') {
      const active = path.endsWith('/activate')
      etat = { ...etat, active, activeVersionId: active ? (body as { versionId: string }).versionId : null }
    }
    return structuredClone(etat)
  })
  const commande = (active: boolean) => ({ id: etat.id, active, revision: resumerWorkflow(etat).revision, confirmer: true })
  return { memoire, n8n, commande }
}

describe('inventaire n8n sans données sensibles', () => {
  it('utilise la version publiée et ne renvoie aucun secret ni paramètre de nœud', () => {
    const w = { ...workflow(), active: false, credentials: { token: 'SECRET' }, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { url: 'secret-url' } }] }
    const resultat = resumerWorkflow(w)
    expect(resultat.active).toBe(true)
    expect(resultat.brouillon).toBe(true)
    expect(JSON.stringify(resultat)).not.toMatch(/SECRET|secret-url|credentials|parameters|nodes/)
    expect(resumerWorkflow(workflow({ activeVersionId: null, active: true })).active).toBe(false)
  })
  it('reconnaît les triggers de la version active, pas ceux du brouillon', () => {
    expect(resumerWorkflow(workflow({ nodes: [{ type: 'n8n-nodes-base.manualTrigger' }], activeVersion: { nodes: [{ type: 'n8n-nodes-base.scheduleTrigger' }] } })).declencheurs).toEqual(['Horaire programmé'])
  })
  it('différencie manuel, archivé, déclencheur désactivé et webhook', () => {
    expect(resumerWorkflow(workflow({ active: false, activeVersionId: null, nodes: [{ type: 'n8n-nodes-base.manualTrigger' }] })).pilotable).toBe(false)
    expect(resumerWorkflow(workflow({ isArchived: true })).pilotable).toBe(false)
    expect(resumerWorkflow(workflow({ activeVersionId: null, nodes: [{ type: 'n8n-nodes-base.webhook', disabled: true }] })).pilotable).toBe(false)
    expect(resumerWorkflow(workflow({ activeVersionId: null })).pilotable).toBe(true)
  })
  it('charge toutes les pages et encode le curseur', async () => {
    const api = vi.fn().mockResolvedValueOnce({ data: [workflow()], nextCursor: 'a+b/=' }).mockResolvedValueOnce({ data: [workflow({ id: 'deux' })], nextCursor: null })
    expect(await listerAutomatisations(api)).toHaveLength(2)
    expect(api.mock.calls[1][0]).toContain('cursor=a%2Bb%2F%3D')
  })
  it('refuse un inventaire incomplet au lieu de faire disparaître des workflows', async () => {
    const api = vi.fn().mockResolvedValue({ data: [workflow()], nextCursor: 'repetition' })
    await expect(listerAutomatisations(api)).rejects.toThrow('inventaire_incomplet')
  })
})

describe('commandes n8n réelles et vérifiées', () => {
  it('arrête puis reprend la version publiée sans publier le brouillon', async () => {
    const b = banc()
    expect((await modifierAutomatisation(b.n8n, b.memoire, b.commande(false))).active).toBe(false)
    expect(b.memoire.memoriser).toHaveBeenCalledWith('test', 'publie-v1')
    expect((await modifierAutomatisation(b.n8n, b.memoire, b.commande(true))).active).toBe(true)
    expect(b.n8n).toHaveBeenCalledWith('/workflows/test/activate', 'POST', { versionId: 'publie-v1' })
    expect(b.memoire.journal).toHaveBeenCalledTimes(2)
    expect(b.memoire.liberer).toHaveBeenCalledTimes(2)
  })
  it('active un scénario non publié avec sa version actuelle', async () => {
    const b = banc(workflow({ activeVersionId: null, active: false }))
    await modifierAutomatisation(b.n8n, b.memoire, b.commande(true))
    expect(b.n8n).toHaveBeenCalledWith('/workflows/test/activate', 'POST', { versionId: 'brouillon-v2' })
  })
  it('refuse un clic depuis une page périmée et libère le verrou', async () => {
    const b = banc()
    await expect(modifierAutomatisation(b.n8n, b.memoire, { ...b.commande(false), revision: 'obsolete' })).rejects.toThrow('etat_modifie')
    expect(b.n8n).toHaveBeenCalledTimes(1)
    expect(b.memoire.liberer).toHaveBeenCalledWith('test')
  })
  it('refuse deux modifications concurrentes', async () => {
    const b = banc(); vi.mocked(b.memoire.verrouiller).mockResolvedValue(false)
    await expect(modifierAutomatisation(b.n8n, b.memoire, b.commande(false))).rejects.toThrow('modification_en_cours')
    expect(b.n8n).not.toHaveBeenCalled()
    expect(b.memoire.liberer).not.toHaveBeenCalled()
  })
  it('ne prétend pas avoir modifié un état non confirmé', async () => {
    const b = banc(); b.n8n.mockImplementation(async () => workflow())
    await expect(modifierAutomatisation(b.n8n, b.memoire, b.commande(false))).rejects.toThrow('etat_non_confirme')
    expect(b.memoire.journal).not.toHaveBeenCalled()
  })
  it('ne publie pas quand la version de reprise est inaccessible', async () => {
    const b = banc(workflow({ activeVersionId: null, active: false })); vi.mocked(b.memoire.version).mockRejectedValue(new Error('base indisponible'))
    await expect(modifierAutomatisation(b.n8n, b.memoire, b.commande(true))).rejects.toThrow('base indisponible')
    expect(b.n8n).toHaveBeenCalledTimes(1)
    expect(b.memoire.liberer).toHaveBeenCalled()
  })
  it.each(['../autre', 'id?attaque=1', ''])('refuse un identifiant invalide %s', async (id) => {
    const b = banc()
    await expect(modifierAutomatisation(b.n8n, b.memoire, { ...b.commande(false), id })).rejects.toThrow('requete_invalide')
    expect(b.n8n).not.toHaveBeenCalled()
  })
  it('ne peut pas publier un scénario manuel ni archivé', async () => {
    for (const props of [{ nodes: [{ type: 'n8n-nodes-base.manualTrigger' }] }, { isArchived: true }]) {
      const b = banc(workflow({ ...props, active: false, activeVersionId: null }))
      await expect(modifierAutomatisation(b.n8n, b.memoire, b.commande(true))).rejects.toThrow('workflow_non_pilotable')
      expect(b.n8n).toHaveBeenCalledTimes(1)
    }
  })
  it('n’expose pas la réponse privée du serveur en cas d’erreur', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('SECRET PRIVÉ', { status: 403 }))
    await expect(clientN8n('https://example.test/', 'cle-privee', fetcher)('/workflows')).rejects.toThrow('acces_n8n_refuse')
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/api/v1/workflows')
    expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  })
})
