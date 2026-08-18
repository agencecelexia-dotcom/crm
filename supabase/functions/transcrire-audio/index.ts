// Edge Function : transcription d'un extrait audio par Deepgram.
//
// Pourquoi un relais serveur plutôt qu'un WebSocket direct depuis le
// navigateur : le streaming Deepgram exige que le client détienne une clé.
// La solution propre serait un jeton éphémère (scope `usage:write`, TTL court),
// mais la clé du compte n'a pas le scope `keys:write` nécessaire pour en
// fabriquer. Envoyer la clé principale au navigateur reviendrait à la publier —
// le bundle front est lisible par tous.
//
// On relaie donc l'audio par tranches. La latence est de quelques secondes au
// lieu du temps réel strict, ce qui reste sous la cadence d'analyse de la
// checklist (4 s) : l'écart est invisible à l'usage.

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

function cors(origin: string | null) {
  const ok = origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

/** Plafond de taille : une tranche de 10 s en webm pèse ~50 ko. Au-delà de
 *  5 Mo, c'est une erreur d'appel, pas un usage normal. */
const TAILLE_MAX = 5 * 1024 * 1024

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const cle = Deno.env.get('DEEPGRAM_API_KEY')
    if (!cle) return json({ ok: false, error: 'Deepgram non configuré' }, 501, CORS)

    const type = req.headers.get('x-audio-type') ?? 'audio/webm'
    const audio = new Uint8Array(await req.arrayBuffer())

    if (audio.byteLength === 0) return json({ ok: false, error: 'audio vide' }, 400, CORS)
    if (audio.byteLength > TAILLE_MAX) return json({ ok: false, error: 'audio trop volumineux' }, 413, CORS)

    const params = new URLSearchParams({
      model: 'nova-2',
      language: 'fr',
      // Restitue les nombres en chiffres — décisif pour les numéros de
      // téléphone dictés à l'oral, qui sont la principale source d'erreur.
      smart_format: 'true',
      punctuate: 'true',
    })

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${cle}`, 'Content-Type': type },
      body: audio,
    })

    if (!res.ok) {
      console.error('deepgram listen', res.status, await res.text())
      return json({ ok: false, error: `Deepgram ${res.status}` }, 502, CORS)
    }

    const d = await res.json()
    const texte = d?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
    return json({ ok: true, texte }, 200, CORS)
  } catch (e) {
    console.error('jeton-deepgram', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}
