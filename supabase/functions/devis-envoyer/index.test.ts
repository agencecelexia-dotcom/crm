// Exécution : deno test --allow-env --no-lock --node-modules-dir=none ce fichier.
// Aucun accès réseau accordé ; Gmail, Storage et RPC sont explicitement simulés.
let handler: (req: Request) => Promise<Response>
const originalServe = Deno.serve
Deno.serve = ((fn: typeof handler) => { handler = fn }) as unknown as typeof Deno.serve
Deno.env.set('SUPABASE_URL', 'https://crm-test.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'cle-service-fictive')
Deno.env.set('DEVIS_EMAIL_WEBHOOK_URL', 'https://n8n.example.test/webhook/devis')
Deno.env.set('DEVIS_EMAIL_WEBHOOK_SECRET', 'secret-fictif-test-local')
await import('./index.ts')
Deno.serve = originalServe

const cle = '00000000-0000-4000-8000-000000000001'
const urlPdf = `https://crm-test.supabase.co/storage/v1/object/public/devis/genere/${'a'.repeat(64)}/test.pdf`
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
function verifier(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

type Cas = 'succes' | 'rejeu' | 'pdf-externe' | 'pdf-invalide' | 'sans-accuse' | 'timeout' | 'conflit' | 'claim-refuse'
async function scenario(cas: Cas, payload: Record<string, unknown>, authorization?: string) {
  const appels: { nom: string; body?: Record<string, unknown> }[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const rpc = url.pathname.split('/rpc/')[1]
    if (rpc) {
      appels.push({ nom: rpc, body })
      if (rpc === 'prendre_envoi_devis') return json(cas !== 'claim-refuse')
      if (rpc === 'reserver_envoi_devis') {
        if (cas === 'conflit') return json({ ok: false, error: 'revision_conflit' })
        if (cas === 'rejeu') return json({ ok: true, deja_envoye: true })
        return json({ ok: true, cle, devis: { pdf_url: cas === 'pdf-externe' ? 'https://externe.example.test/fichier.pdf' : urlPdf, client_email: 'client@example.test', numero: 'DEV-FICTIF', email_subject: 'Fictif', email_html: '<p>Fictif</p>' } })
      }
      if (rpc === 'finaliser_envoi_devis') return json({ ok: true })
    }
    if (url.href === urlPdf) { appels.push({ nom: 'pdf' }); return new Response(cas === 'pdf-invalide' ? 'pas un PDF' : '%PDF-1.4\nFichier fictif') }
    if (url.hostname === 'n8n.example.test') {
      appels.push({ nom: 'email_simule', body })
      if (cas === 'timeout') throw new Error('Timeout fictif')
      return json(cas === 'sans-accuse' ? { message: 'Workflow started' } : { ok: true, accepted: true, idempotency_key: cle })
    }
    throw new Error('Sortie non simulée interdite : ' + url.origin)
  }) as typeof fetch
  try {
    const reponse = await handler(new Request('https://edge.example.test/devis-envoyer', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(payload) }))
    return { statut: reponse.status, resultat: await reponse.json(), appels }
  } finally { globalThis.fetch = originalFetch }
}
const demande = { token: 'artisan-fictif-local-sans-donnees', devis_id: '00000000-0000-4000-8000-000000000002', revision: 3 }

Deno.test('envoi : réserve la bonne révision, transmet, puis confirme', async () => {
  const r = await scenario('succes', demande)
  verifier(r.resultat.ok && r.resultat.accepted, 'accusé absent')
  verifier(r.appels.map(a => a.nom).join(',') === 'reserver_envoi_devis,pdf,email_simule,finaliser_envoi_devis', 'ordre incorrect')
  verifier(r.appels[0].body?.p_revision === 3, 'révision perdue')
  verifier(r.appels[3].body?.p_etat === 'confirme', 'état confirmé absent')
})
for (const cas of ['sans-accuse', 'timeout'] as const) Deno.test(`envoi : ${cas} reste incertain`, async () => {
  const r = await scenario(cas, demande)
  verifier(r.resultat.ok === false && r.resultat.error === 'envoi_a_verifier', 'faux succès')
  verifier(r.appels.at(-1)?.body?.p_etat === 'incertain', 'état incertain absent')
})
for (const cas of ['pdf-externe', 'pdf-invalide'] as const) Deno.test(`envoi : ${cas} bloqué avant mail`, async () => {
  const r = await scenario(cas, demande)
  verifier(r.resultat.ok === false, 'faux succès')
  verifier(!r.appels.some(a => a.nom === 'email_simule'), 'email contacté malgré PDF refusé')
  verifier(r.appels.at(-1)?.body?.p_etat === 'echec', 'échec récupérable non mémorisé')
})
for (const cas of ['rejeu', 'conflit'] as const) Deno.test(`envoi : ${cas} n’appelle pas la messagerie`, async () => {
  const r = await scenario(cas, demande)
  verifier(r.appels.length === 1 && r.appels[0].nom === 'reserver_envoi_devis', 'envoi supplémentaire')
})
Deno.test('callback : secret obligatoire avant toute consommation de clé', async () => {
  const r = await scenario('succes', { action: 'prendre_envoi', idempotency_key: cle })
  verifier(r.statut === 403 && r.appels.length === 0, 'callback non autorisé')
})
Deno.test('callback : le booléen SQL est rendu explicitement en ok', async () => {
  for (const cas of ['succes', 'claim-refuse'] as const) {
    const r = await scenario(cas, { action: 'prendre_envoi', idempotency_key: cle }, 'Bearer secret-fictif-test-local')
    verifier(r.resultat.ok === (cas === 'succes'), 'prise unique mal interprétée')
    verifier(r.appels.length === 1 && r.appels[0].nom === 'prendre_envoi_devis', 'appel inattendu')
  }
})
