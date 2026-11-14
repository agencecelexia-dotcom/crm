import { createClient } from 'jsr:@supabase/supabase-js@2'
import { jetonDe, membreActif } from '../_membre.ts'
import { emailInvitation, validerInvitation } from '../_invitation-artisan.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'methode_invalide' }, 405)
  let p: Record<string, unknown>
  try { p = await req.json() } catch { return json({ ok: false, error: 'requete_invalide' }, 400) }
  if (!p || typeof p !== 'object' || !uuid(p.id)) return json({ ok: false, error: 'requete_invalide' }, 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const secret = Deno.env.get('INSCRIPTION_EMAIL_WEBHOOK_SECRET')

  // n8n consomme la demande avant Gmail puis confirme son identifiant après.
  // Aucun jeton de session, ni clé service_role, ne sort vers le workflow.
  if (p.action === 'prendre' || p.action === 'confirmer') {
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ ok: false }, 403)
    if (p.action === 'prendre') {
      const { data, error } = await admin.from('invitations_artisans').update({ etat: 'en_cours' }).eq('id', p.id).eq('etat', 'reserve').select('id').maybeSingle()
      return json({ ok: !error && !!data })
    }
    if (typeof p.message_id !== 'string' || !/^[\w-]{1,200}$/.test(p.message_id)) return json({ ok: false }, 400)
    const { data, error } = await admin.from('invitations_artisans').update({ etat: 'confirme', gmail_message_id: p.message_id, envoye_at: new Date().toISOString() }).eq('id', p.id).in('etat', ['en_cours', 'incertain']).select('id').maybeSingle()
    return json({ ok: !error && !!data, id: p.id })
  }

  try {
    const membre = await membreActif(jetonDe(req))
    if (!membre) return json({ ok: false, error: 'connexion_requise' }, 401)
    if (membre.role !== 'fondateur') {
      const { data } = await admin.from('membres').select('peut_creer_artisan').eq('user_id', membre.user_id).single()
      if (!data?.peut_creer_artisan) return json({ ok: false, error: 'non_autorise' }, 403)
    }
    let invitation
    try { invitation = validerInvitation(p) } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : 'requete_invalide' }, 400) }
    const existant = await admin.from('invitations_artisans').select('*').eq('id', p.id).maybeSingle()
    if (existant.error) return json({ ok: false, error: 'journal_indisponible' }, 503)
    if (existant.data) {
      const d = existant.data
      if (d.created_by !== membre.user_id || Object.entries(invitation).some(([k, v]) => d[k] !== v)) return json({ ok: false, error: 'demande_differente' }, 409)
      return json({ ok: d.etat === 'confirme', etat: d.etat, deja_traite: true, error: d.etat === 'confirme' ? undefined : 'envoi_a_verifier' })
    }
    const webhook = Deno.env.get('INSCRIPTION_EMAIL_WEBHOOK_URL')
    if (!webhook || !secret) return json({ ok: false, error: 'service_non_configure' }, 503)
    const limite = await admin.from('invitations_artisans').select('id', { count: 'exact', head: true }).eq('created_by', membre.user_id).gte('created_at', new Date(Date.now() - 3600000).toISOString())
    if (limite.error) return json({ ok: false, error: 'journal_indisponible' }, 503)
    if ((limite.count ?? 0) >= 60) return json({ ok: false, error: 'limite_horaire' }, 429)
    const { error } = await admin.from('invitations_artisans').insert({ id: p.id, created_by: membre.user_id, ...invitation })
    if (error) return json({ ok: false, error: error.code === '23505' ? 'envoi_a_verifier' : 'reservation_impossible' }, 409)
    const email = emailInvitation(invitation)
    try {
      const reponse = await fetch(webhook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ id: p.id, email: invitation.email, subject: email.subject, html: email.html }) })
      const accuse = await reponse.json().catch(() => null)
      if (!reponse.ok || accuse?.ok !== true || accuse?.id !== p.id) throw new Error('non_confirme')
      const { data } = await admin.from('invitations_artisans').select('etat').eq('id', p.id).single()
      if (data?.etat !== 'confirme') throw new Error('non_confirme')
      return json({ ok: true, etat: 'confirme' })
    } catch {
      // Ne jamais relancer automatiquement : Gmail peut avoir accepté l'email.
      await admin.from('invitations_artisans').update({ etat: 'incertain' }).eq('id', p.id).in('etat', ['reserve', 'en_cours'])
      return json({ ok: false, etat: 'incertain', error: 'envoi_a_verifier' })
    }
  } catch {
    return json({ ok: false, error: 'service_indisponible' }, 503)
  }
})
