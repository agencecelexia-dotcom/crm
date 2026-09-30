// Quels modèles de Claude la clé de ce projet peut-elle appeler ? Un mot en
// retour à chacun (un jeton de sortie) : le coût est négligeable. Réservé à la
// clé de service — un outil d'exploitation, pas une fonction de l'écran.
//
//   curl -X POST "$SUPABASE_URL/functions/v1/ia-ping" -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
//   (ajouter {"modeles":["claude-sonnet-5-5"]} pour n'en essayer qu'un)

import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0'
import { MODELES_A_ESSAYER, modeleVision } from '../_modeles.ts'

Deno.serve(async (req) => {
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!service || req.headers.get('authorization') !== `Bearer ${service}`) return new Response('interdit', { status: 403 })
  const cle = Deno.env.get('ANTHROPIC_API_KEY')
  if (!cle) return Response.json({ ok: false, error: 'ANTHROPIC_API_KEY absente' })
  const corps = (await req.json().catch(() => ({}))) as { modeles?: string[] }
  const liste = corps.modeles?.length ? corps.modeles : MODELES_A_ESSAYER
  const client = new Anthropic({ apiKey: cle })
  const resultats = await Promise.all(
    liste.map(async (modele) => {
      const t0 = performance.now()
      try {
        const r = await client.messages.create({ model: modele, max_tokens: 8, messages: [{ role: 'user', content: 'Réponds : ok' }] })
        return { modele, ok: true, servi: r.model, ms: Math.round(performance.now() - t0), entree: r.usage.input_tokens, sortie: r.usage.output_tokens }
      } catch (e) {
        return { modele, ok: false, erreur: e instanceof Anthropic.APIError ? `${e.status} ${e.message}`.slice(0, 200) : String(e).slice(0, 200) }
      }
    }),
  )
  return Response.json({ ok: true, modele_vision: modeleVision(), resultats })
})
