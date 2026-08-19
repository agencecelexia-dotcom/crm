// Edge Function : délivre une URL signée pour consulter une pièce jointe de
// projet depuis l'espace artisan (accès anonyme, par token d'affectation).
//
// Pourquoi une fonction serveur : le bucket `documents` est privé, et une URL
// signée ne peut être fabriquée qu'avec la service_role. L'artisan accède en
// `anon` — il ne peut donc pas signer lui-même, et PostgreSQL ne sait pas le
// faire non plus (cf. note en fin de migration 0066).
//
// Le contrôle d'accès tient en une requête : le token doit désigner une
// affectation vivante dont le projet porte la pièce demandée, et la pièce doit
// être marquée `visible_artisan`. Le chemin de stockage ne sort jamais d'ici.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Durée de validité d'une URL signée. Aligné sur `urlSignee()` côté agence. */
const EXPIRATION_SEC = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { token, document_id, download } = await req.json()
    if (!token || !document_id) {
      return json({ ok: false, error: 'requête invalide' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Le token doit correspondre à une affectation vivante, et la pièce doit
    // appartenir au projet de CETTE affectation. On repart de `affectations`
    // pour que le filtre porte sur la ligne qui prouve le lien artisan/chantier.
    const { data: affectation, error: ae } = await admin
      .from('affectations')
      .select('projet_id')
      .eq('token', token)
      .is('retire_at', null)
      .maybeSingle()
    if (ae || !affectation) return json({ ok: false, error: 'accès refusé' }, 403)

    const { data: doc, error: de } = await admin
      .from('projet_documents')
      .select('chemin, nom, visible_artisan')
      .eq('id', document_id)
      .eq('projet_id', affectation.projet_id)
      .maybeSingle()
    // Même réponse qu'un token invalide : ne pas distinguer « pièce inexistante »
    // de « pièce non partagée » évite de confirmer l'existence d'un document.
    if (de || !doc || !doc.visible_artisan) {
      return json({ ok: false, error: 'accès refusé' }, 403)
    }

    const { data: signed, error: se } = await admin.storage
      .from('documents')
      .createSignedUrl(doc.chemin, EXPIRATION_SEC, download ? { download: doc.nom } : undefined)
    if (se || !signed) return json({ ok: false, error: 'document introuvable' }, 404)

    return json({ ok: true, url: signed.signedUrl })
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
