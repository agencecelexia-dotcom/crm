import { createClient } from 'jsr:@supabase/supabase-js@2'
import { pdfDevisAutorise, priseEnChargeConfirmee } from '../_envoi-devis.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
})

/**
 * Contrat du workflow : retourner {ok:true, accepted:true, idempotency_key}
 * seulement après prise en charge durable. Avant Gmail, le workflow appelle
 * l'action privée prendre_envoi : la base consomme la clé une seule fois.
 * Le statut HTTP seul, une réponse opaque ou « workflow started » ne suffisent pas.
 * Aucun renvoi automatique après timeout/réponse ambiguë : intervention Celexia.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'methode_invalide' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let payload: Record<string, unknown>
  try { payload = await req.json() } catch { return json({ ok: false, error: 'requete_invalide' }, 400) }
  if (!payload || typeof payload !== 'object') return json({ ok: false, error: 'requete_invalide' }, 400)
  const secret = Deno.env.get('DEVIS_EMAIL_WEBHOOK_SECRET')
  // Callback borné au relais autorisé : ni jeton artisan, ni données client,
  // ni clé service_role ne sont confiés au workflow pour cette opération.
  if (payload.action === 'prendre_envoi') {
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ ok: false, error: 'non_autorise' }, 403)
    if (typeof payload.idempotency_key !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.idempotency_key)) return json({ ok: false, error: 'requete_invalide' }, 400)
    const { data, error } = await admin.rpc('prendre_envoi_devis', { p_cle: payload.idempotency_key })
    if (error) return json({ ok: false, error: 'verification_indisponible' }, 503)
    return json({ ok: data === true, ...(data === true ? {} : { error: 'envoi_refuse' }) })
  }
  const webhook = Deno.env.get('DEVIS_EMAIL_WEBHOOK_URL')
  if (!webhook || !secret) return json({ ok: false, error: 'service_non_configure' })
  let reservation: { token: string; devis_id: string; cle: string } | undefined
  let requeteEnvoyee = false
  try {
    const { token, devis_id, revision } = payload
    if (typeof token !== 'string' || token.length < 16 || typeof devis_id !== 'string') return json({ ok: false, error: 'non_autorise' }, 400)
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return json({ ok: false, error: 'revision_invalide' }, 400)
    const { data: r, error } = await admin.rpc('reserver_envoi_devis', { p_token: token, p_devis_id: devis_id, p_revision: revision })
    if (error) return json({ ok: false, error: 'reservation_impossible' })
    if (!r?.ok || r.deja_envoye) return json(r ?? { ok: false, error: 'non_autorise' })
    reservation = { token, devis_id, cle: r.cle }
    const d = r.devis
    if (!pdfDevisAutorise(d.pdf_url, supabaseUrl)) throw new Error('pdf_invalide')
    const fichier = await fetch(d.pdf_url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!fichier.ok || Number(fichier.headers.get('content-length') ?? 0) > 10_000_000) throw new Error('pdf_indisponible')
    const bytes = new Uint8Array(await fichier.arrayBuffer())
    if (bytes.length > 10_000_000 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('pdf_invalide')
    let binaire = ''
    for (let i = 0; i < bytes.length; i += 8192) binaire += String.fromCharCode(...bytes.subarray(i, i + 8192))
    requeteEnvoyee = true
    const response = await fetch(webhook, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json', ...(Deno.env.get('DEVIS_EMAIL_WEBHOOK_SECRET') ? { Authorization: `Bearer ${Deno.env.get('DEVIS_EMAIL_WEBHOOK_SECRET')}` } : {}) },
      body: JSON.stringify({ event: 'envoyer_devis_client', email: d.client_email,
        numero: d.numero, filename: `devis-${d.numero}.pdf`, subject: d.email_subject,
        html: d.email_html, pdf_base64: btoa(binaire), idempotency_key: r.cle }),
    })
    const accuse = await response.json().catch(() => null)
    if (!response.ok || !priseEnChargeConfirmee(accuse, r.cle)) throw new Error('envoi_a_verifier')
    const { data: fin, error: erreurFin } = await admin.rpc('finaliser_envoi_devis', {
      p_token: token, p_devis_id: devis_id, p_cle: r.cle, p_etat: 'confirme',
    })
    if (erreurFin || !fin?.ok) throw new Error('envoi_a_verifier')
    return json({ ok: true, accepted: true })
  } catch (e) {
    if (reservation) {
      await admin.rpc('finaliser_envoi_devis', {
        p_token: reservation.token, p_devis_id: reservation.devis_id,
        p_cle: reservation.cle, p_etat: requeteEnvoyee ? 'incertain' : 'echec',
      })
    }
    return json({ ok: false, error: requeteEnvoyee ? 'envoi_a_verifier' : e instanceof Error && e.message.startsWith('pdf_') ? e.message : 'envoi_impossible' })
  }
})
