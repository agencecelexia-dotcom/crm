// Le navigateur ne reçoit jamais nodes, parameters, credentials ou URL de webhook.
export interface WorkflowN8n {
  id: string
  name: string
  active: boolean
  activeVersionId?: string | null
  versionId?: string
  updatedAt?: string
  isArchived?: boolean
  nodes?: { type: string; disabled?: boolean }[]
  activeVersion?: { nodes?: { type: string; disabled?: boolean }[] }
}

export interface AutomatisationN8n {
  id: string
  nom: string
  active: boolean
  archivee: boolean
  declencheurs: string[]
  pilotable: boolean
  revision: string
  brouillon: boolean
}

export class ErreurAutomatisation extends Error {
  status: number
  constructor(message: string, status = 502) { super(message); this.status = status }
}

export function resumerWorkflow(w: WorkflowN8n): AutomatisationN8n {
  const active = 'activeVersionId' in w ? !!w.activeVersionId : w.active
  const nodes = (active && w.activeVersion?.nodes ? w.activeVersion.nodes : w.nodes) ?? []
  const types = nodes.filter((n) => !n.disabled).map((n) => n.type.toLowerCase())
  const declencheurs: string[] = []
  if (types.some((t) => t.endsWith('.scheduletrigger') || t.endsWith('.cron') || t.endsWith('.interval'))) declencheurs.push('Horaire programmé')
  if (types.some((t) => t.endsWith('.webhook') || t.endsWith('.formtrigger'))) declencheurs.push('Réception d’une demande')
  if (types.some((t) => t.includes('mcptrigger'))) declencheurs.push('Connexion aux outils IA')
  if (types.some((t) => t.endsWith('trigger') && !/manualtrigger|executeworkflowtrigger|scheduletrigger|mcptrigger|formtrigger/.test(t))) declencheurs.push('Événement externe')
  return {
    id: w.id, nom: w.name, active, archivee: !!w.isArchived, declencheurs,
    pilotable: !w.isArchived && (active || declencheurs.length > 0),
    revision: [w.updatedAt ?? '', w.versionId ?? '', w.activeVersionId ?? '', active].join('|'),
    brouillon: !!(w.activeVersionId && w.versionId && w.activeVersionId !== w.versionId),
  }
}

type RequeteN8n = (path: string, method?: 'GET' | 'POST', body?: unknown) => Promise<unknown>
export interface MemoireN8n {
  verrouiller(id: string): Promise<boolean>
  liberer(id: string): Promise<void>
  version(id: string): Promise<string | null>
  memoriser(id: string, version: string): Promise<void>
  journal(id: string, nom: string, avant: boolean, apres: boolean): Promise<void>
}

export async function listerAutomatisations(n8n: RequeteN8n): Promise<AutomatisationN8n[]> {
  const resultat: AutomatisationN8n[] = []
  let cursor: string | null = null
  const vus = new Set<string>()
  do {
    const page = await n8n('/workflows?limit=100&excludePinnedData=true' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')) as { data: WorkflowN8n[]; nextCursor?: string | null }
    if (!Array.isArray(page.data)) throw new ErreurAutomatisation('inventaire_indisponible')
    resultat.push(...page.data.map(resumerWorkflow))
    cursor = page.nextCursor ?? null
    if (cursor && vus.has(cursor)) throw new ErreurAutomatisation('inventaire_incomplet')
    if (cursor) vus.add(cursor)
    if (vus.size > 100) throw new ErreurAutomatisation('inventaire_incomplet')
  } while (cursor)
  return resultat.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

export async function modifierAutomatisation(
  n8n: RequeteN8n, memoire: MemoireN8n,
  entree: { id: string; active: boolean; revision: string; confirmer?: boolean },
): Promise<AutomatisationN8n> {
  if (typeof entree.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entree.id) || typeof entree.active !== 'boolean' || typeof entree.revision !== 'string') {
    throw new ErreurAutomatisation('requete_invalide', 400)
  }
  if (!await memoire.verrouiller(entree.id)) throw new ErreurAutomatisation('modification_en_cours', 409)
  try {
    const path = `/workflows/${encodeURIComponent(entree.id)}`
    const w = await n8n(path) as WorkflowN8n
    const avant = resumerWorkflow(w)
    if (avant.revision !== entree.revision) throw new ErreurAutomatisation('etat_modifie', 409)
    if (!avant.pilotable) throw new ErreurAutomatisation('workflow_non_pilotable', 400)
    if (avant.active === entree.active) return avant
    // L'appel doit provenir d'une commande explicite. L'écran présente une
    // confirmation supplémentaire pour le scénario de suppression des sites.
    if (entree.active && !entree.confirmer) throw new ErreurAutomatisation('confirmation_requise', 400)
    let version: string | null = null
    if (!entree.active && w.activeVersionId) await memoire.memoriser(w.id, w.activeVersionId)
    if (entree.active) version = await memoire.version(w.id) ?? w.versionId ?? null
    // API publique, compatible n8n 1 et 2. versionId empêche la publication d'un
    // brouillon lors d'une reprise ; les paramètres du workflow restent intacts.
    await n8n(`${path}/${entree.active ? 'activate' : 'deactivate'}`, 'POST', version ? { versionId: version } : {})
    const apres = resumerWorkflow(await n8n(path) as WorkflowN8n)
    if (apres.active !== entree.active) throw new ErreurAutomatisation('etat_non_confirme')
    await memoire.journal(w.id, w.name, avant.active, apres.active)
    return apres
  } finally {
    await memoire.liberer(entree.id)
  }
}

export function clientN8n(url: string, cle: string, fetcher: typeof fetch = fetch): RequeteN8n {
  if (!url || !cle) throw new ErreurAutomatisation('connexion_non_configuree', 503)
  const base = url.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  if (!base.startsWith('https://')) throw new ErreurAutomatisation('connexion_non_configuree', 503)
  return async (path, method = 'GET', body) => {
    let reponse: Response
    try {
      reponse = await fetcher(`${base}/api/v1${path}`, {
        method, headers: { 'X-N8N-API-KEY': cle, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000), redirect: 'error',
      })
    } catch { throw new ErreurAutomatisation('connexion_n8n_interrompue') }
    // Ne jamais propager la réponse brute : elle peut contenir des paramètres privés.
    if (!reponse.ok) throw new ErreurAutomatisation(reponse.status === 401 || reponse.status === 403 ? 'acces_n8n_refuse' : 'commande_n8n_refusee')
    try { return await reponse.json() } catch { throw new ErreurAutomatisation('reponse_n8n_invalide') }
  }
}
