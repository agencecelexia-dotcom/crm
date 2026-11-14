import { createClient } from 'jsr:@supabase/supabase-js@2'
import { jetonDe, membreActif } from '../_membre.ts'
import { clientN8n, ErreurAutomatisation, listerAutomatisations, modifierAutomatisation, type MemoireN8n } from '../_automatisations-n8n.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'methode_refusee' }, 405)
  try {
    const membre = await membreActif(jetonDe(req))
    if (!membre) return json({ error: 'connexion_requise' }, 401)
    if (membre.role !== 'fondateur') return json({ error: 'reserve_fondateur' }, 403)
    let body
    try { body = await req.json() } catch { return json({ error: 'requete_invalide' }, 400) }
    if (!body || !['lister','modifier'].includes(body.action)) return json({ error: 'requete_invalide' }, 400)
    const n8n = clientN8n(Deno.env.get('N8N_URL') ?? '', Deno.env.get('N8N_API_KEY') ?? '')
    if (body.action === 'lister') return json({ workflows: await listerAutomatisations(n8n), verifie_le: new Date().toISOString() })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const verrou = crypto.randomUUID()
    const memoire: MemoireN8n = {
      async verrouiller(id) {
        const { data, error } = await admin.rpc('verrouiller_automatisation_n8n', { p_id: id, p_verrou: verrou })
        if (error) throw new ErreurAutomatisation('journal_indisponible')
        return data === true
      },
      async liberer(id) {
        // Expire seul après 2 minutes si la connexion à la base est interrompue.
        await admin.from('automatisations_n8n_etat').update({ verrou: null, verrou_jusqua: null }).eq('id', id).eq('verrou', verrou)
      },
      async version(id) {
        const { data, error } = await admin.from('automatisations_n8n_etat').select('version_reprise').eq('id', id).single()
        if (error) throw new ErreurAutomatisation('journal_indisponible')
        return data?.version_reprise ?? null
      },
      async memoriser(id, version) {
        const { error } = await admin.from('automatisations_n8n_etat').update({ version_reprise: version }).eq('id', id).eq('verrou', verrou)
        if (error) throw new ErreurAutomatisation('journal_indisponible')
      },
      async journal(id, nom, avant, apres) {
        const { error } = await admin.from('automatisations_journal').insert({ source: 'n8n', cle: id, titre: nom, avant: avant ? 'on' : 'off', apres: apres ? 'on' : 'off', auteur: membre.user_id })
        if (error) throw new ErreurAutomatisation('etat_modifie_journal_indisponible')
      },
    }
    return json({ workflow: await modifierAutomatisation(n8n, memoire, body) })
  } catch (e) {
    return json({ error: e instanceof ErreurAutomatisation ? e.message : 'service_indisponible' }, e instanceof ErreurAutomatisation ? e.status : 502)
  }
})
