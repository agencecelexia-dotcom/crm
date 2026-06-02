// Edge Function : upload d'un devis par l'artisan depuis l'espace public.
// Sécurisé par le token de la mission (projet). Utilise la service_role
// (injectée automatiquement dans le runtime) — jamais exposée au front.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { token, slot, filename, base64 } = await req.json()

    // Validation des entrées
    if (!token || !['devis', 'devis_signe'].includes(slot) || !base64) {
      return json({ ok: false, error: 'requête invalide' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Le token doit correspondre à un projet existant
    const { data: projet, error: pe } = await admin
      .from('projets')
      .select('id')
      .eq('token', token)
      .single()
    if (pe || !projet) return json({ ok: false, error: 'mission introuvable' }, 404)

    // Décodage base64 → octets
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const ext = (filename?.split('.').pop() || 'pdf').toLowerCase()
    const chemin = `${projet.id}/${slot}.${ext}`

    const { error: ue } = await admin.storage
      .from('documents')
      .upload(chemin, bytes, { upsert: true, contentType: 'application/pdf' })
    if (ue) return json({ ok: false, error: ue.message }, 500)

    // Enregistre le chemin dans la bonne colonne du projet
    const champ = slot === 'devis' ? 'devis_url' : 'devis_signe_url'
    const { error: upe } = await admin
      .from('projets')
      .update({ [champ]: chemin })
      .eq('id', projet.id)
    if (upe) return json({ ok: false, error: upe.message }, 500)

    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
