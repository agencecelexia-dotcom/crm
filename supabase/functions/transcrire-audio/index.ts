// Edge Function : relais WebSocket entre le navigateur et Deepgram.
//
// Le navigateur ouvre un WebSocket vers cette fonction, qui en ouvre un second
// vers Deepgram et fait transiter l'audio dans un sens, les transcriptions dans
// l'autre. La clé Deepgram reste côté serveur : un WebSocket direct l'aurait
// exigée dans le bundle, donc publiée.
//
// Pourquoi un flux continu plutôt que des tranches indépendantes : Deepgram
// reconstitue les mots à cheval sur deux paquets et affine sa transcription
// avec le contexte. Découpé en fichiers de 8 s, « Aubigeon » prononcé à la
// frontière ressortait « Aubi » — un nom tronqué que rien ne signalait.
//
// Le mode POST reste accepté pour la transcription d'un fichier complet
// (tests, et repli si le WebSocket échoue).

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

function cors(origin: string | null) {
  const ok = origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-audio-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const TAILLE_MAX = 5 * 1024 * 1024

/** Paramètres communs aux deux modes.
 *
 *  `sr` vient du navigateur : chaque micro a sa fréquence native (48 kHz le
 *  plus souvent). La déclarer faussement décale tout le signal. */
function params(streaming: boolean, sr?: string | null) {
  const p = new URLSearchParams({
    // nova-3 comprend nettement mieux une voix lointaine et compressée —
    // exactement le cas d'un haut-parleur de téléphone.
    model: 'nova-3',
    language: 'fr',
    // Restitue les nombres en chiffres : décisif sur les numéros dictés.
    smart_format: 'true',
    punctuate: 'true',
  })
  if (streaming) {
    p.set('interim_results', 'true')
    // Deepgram réécrit ses résultats provisoires quand la suite les éclaire —
    // c'est exactement ce qui rattrape un nom coupé en deux paquets.
    p.set('encoding', 'linear16')
    p.set('sample_rate', sr && /^\d{4,6}$/.test(sr) ? sr : '48000')
    p.set('endpointing', '300')
    // Un appel a deux voix : les séparer aide le modèle à ne pas mélanger la
    // question du commercial et la réponse du client.
    p.set('diarize', 'true')
  }
  return p
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  const cle = Deno.env.get('DEEPGRAM_API_KEY')

  // ---- Mode streaming ----
  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    if (!cle) return new Response('Deepgram non configuré', { status: 501 })

    const { socket: client, response } = Deno.upgradeWebSocket(req)

    const sr = new URL(req.url).searchParams.get('sr')
    const amont = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params(true, sr)}`,
      ['token', cle],
    )
    amont.binaryType = 'arraybuffer'

    // L'audio arrivé avant l'ouverture d'amont serait perdu : on le garde.
    const attente: ArrayBuffer[] = []

    amont.onopen = () => {
      for (const a of attente) amont.send(a)
      attente.length = 0
    }
    amont.onmessage = (e) => {
      if (client.readyState === WebSocket.OPEN) client.send(e.data)
    }
    amont.onerror = () => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ erreur: 'connexion Deepgram interrompue' }))
      }
    }
    amont.onclose = () => client.readyState === WebSocket.OPEN && client.close()

    client.onmessage = (e) => {
      const d = e.data
      if (typeof d === 'string') {
        // Message de contrôle du navigateur (KeepAlive, CloseStream).
        if (amont.readyState === WebSocket.OPEN) amont.send(d)
        return
      }
      if (amont.readyState === WebSocket.OPEN) amont.send(d)
      else attente.push(d as ArrayBuffer)
    }
    client.onclose = () => amont.readyState === WebSocket.OPEN && amont.close()
    client.onerror = () => amont.readyState === WebSocket.OPEN && amont.close()

    return response
  }

  // ---- Mode fichier complet ----
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (!cle) return json({ ok: false, error: 'Deepgram non configuré' }, 501, CORS)

    const type = req.headers.get('x-audio-type') ?? 'audio/webm'
    const audio = new Uint8Array(await req.arrayBuffer())
    if (audio.byteLength === 0) return json({ ok: false, error: 'audio vide' }, 400, CORS)
    if (audio.byteLength > TAILLE_MAX) return json({ ok: false, error: 'audio trop volumineux' }, 413, CORS)

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params(false)}`, {
      method: 'POST',
      headers: { Authorization: `Token ${cle}`, 'Content-Type': type },
      body: audio,
    })
    if (!res.ok) {
      console.error('deepgram listen', res.status, await res.text())
      return json({ ok: false, error: `Deepgram ${res.status}` }, 502, CORS)
    }

    const d = await res.json()
    return json(
      { ok: true, texte: d?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '' },
      200,
      CORS,
    )
  } catch (e) {
    console.error('transcrire-audio', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}
