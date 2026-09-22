// Edge Function : lit les devis PDF déjà déposés et en tire un référentiel.
//
// 107 devis Batryx dorment dans le bucket `devis`. Tant qu'ils restent en PDF,
// ils ne servent à rien. Lus, ils donnent ce qu'on met vraiment sur un devis
// de ravalement ou de couverture, avec quelles unités et quels ordres de prix.
//
// C'est un traitement par LOTS, déclenché à la demande : chaque appel lit
// quelques documents et s'arrête. Un PDF fait 400 Ko et trois pages ; tout
// traiter d'un coup dépasserait le temps imparti à une edge function.
//
// Les échecs sont enregistrés comme tels : un document illisible ne doit pas
// revenir dans la file à chaque passage.

const MODELE = 'claude-sonnet-5'
const LOT_MAX = 5

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

function cors(origin: string | null) {
  const ok =
    origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}

const OUTIL = {
  name: 'enregistrer_lignes',
  description: "Enregistre les lignes de prestation lues sur le devis.",
  input_schema: {
    type: 'object',
    properties: {
      lignes: {
        type: 'array',
        description:
          "Une entrée par ligne de prestation du devis. N'inclus NI les totaux, NI "
          + "la TVA, NI l'acompte, NI les mentions légales — uniquement les prestations "
          + "facturées.",
        items: {
          type: 'object',
          properties: {
            designation: {
              type: 'string',
              description:
                "Libellé de la prestation, tel qu'écrit mais débarrassé des numéros de "
                + "ligne et des renvois. Garde le matériau et la technique quand ils "
                + "figurent : « Ravalement façade enduit monocouche gratté » vaut mieux "
                + "que « Ravalement ».",
            },
            unite: {
              type: 'string',
              description: "m2, ml, u, forfait, h, m3, kg… Vide si absente.",
            },
            quantite: { type: 'number' },
            prix_unitaire: { type: 'number', description: 'Prix unitaire HT.' },
            montant: { type: 'number', description: 'Total HT de la ligne.' },
          },
          required: ['designation'],
        },
      },
      lisible: {
        type: 'boolean',
        description:
          "Faux si le document n'est pas un devis, ou s'il est trop dégradé pour en "
          + "tirer quoi que ce soit. Dans ce cas, renvoie une liste vide.",
      },
    },
    required: ['lignes', 'lisible'],
  },
}

const CONSIGNE = `Tu lis un devis d'entreprise du bâtiment et tu en extrais les lignes de prestation.

Ce qui compte :

1. UNE LIGNE PAR PRESTATION FACTURÉE. Ignore les totaux, sous-totaux, TVA, acomptes, conditions de paiement, mentions légales et coordonnées.

2. GARDE LA MATIÈRE. « Ravalement façade enduit monocouche gratté » est utile ; « Ravalement » ne l'est pas. Si le devis précise le matériau, l'épaisseur ou la technique, conserve-les dans la désignation.

3. NE CALCULE PAS, NE DEVINE PAS. Si le prix unitaire n'est pas écrit, laisse-le vide plutôt que de le déduire du total. Si la quantité est absente, laisse-la vide.

4. UN DEVIS AU FORFAIT reste une ligne : unité « forfait », quantité 1.

Si le document n'est pas un devis — une facture, une attestation, une photo — réponds lisible = false avec une liste vide.`

async function claude(cle: string, base64: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: 4000,
      system: CONSIGNE,
      tools: [OUTIL],
      tool_choice: { type: 'tool', name: 'enregistrer_lignes' },
      messages: [{
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        }],
      }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status} : ${(await res.text()).slice(0, 200)}`)
  const rep = await res.json()
  const bloc = (rep.content ?? []).find((c: { type: string }) => c.type === 'tool_use')
  if (!bloc) throw new Error('réponse sans tool_use')
  return bloc.input as { lignes: unknown[]; lisible: boolean }
}

/** Appelle une RPC en service_role — le traitement tourne sans utilisateur. */
async function rpc(nom: string, params: unknown) {
  const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: cle,
      authorization: `Bearer ${cle}`,
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status} : ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const cle = Deno.env.get('ANTHROPIC_API_KEY')
    if (!cle) return json({ ok: false, error: 'cle_absente' }, 500, CORS)

    // Réservé à l'agence : c'est un traitement coûteux sur des documents
    // commerciaux. La clé de service suffit (appel depuis un script d'ops),
    // sinon un JWT de fondateur.
    const jeton = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (jeton !== service) {
      const u = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
        headers: { apikey: service, authorization: `Bearer ${jeton}` },
      })
      if (!u.ok) return json({ ok: false, error: 'non_authentifie' }, 401, CORS)
      const membre = await rpc('est_fondateur', {})
      if (membre !== true) return json({ ok: false, error: 'reserve_fondateur' }, 403, CORS)
    }

    const { limite } = await req.json().catch(() => ({ limite: LOT_MAX }))
    const lot = Math.min(Math.max(Number(limite) || LOT_MAX, 1), LOT_MAX)

    const aTraiter = (await rpc('corpus_a_traiter', { p_limite: lot })) as {
      affectation_id: string
      devis_url: string
      metier: string | null
    }[]

    const resultats: { id: string; lignes?: number; erreur?: string }[] = []

    for (const d of aTraiter) {
      try {
        const f = await fetch(d.devis_url)
        if (!f.ok) throw new Error(`téléchargement ${f.status}`)
        const buf = new Uint8Array(await f.arrayBuffer())

        // 4,5 Mo : au-delà, l'API refuse et l'appel coûte pour rien.
        if (buf.byteLength > 4_500_000) throw new Error('PDF trop lourd')

        let bin = ''
        for (let i = 0; i < buf.length; i += 8192) {
          bin += String.fromCharCode(...buf.subarray(i, i + 8192))
        }
        const lu = await claude(cle, btoa(bin))

        if (!lu.lisible || !Array.isArray(lu.lignes) || lu.lignes.length === 0) {
          await rpc('enregistrer_extraction', {
            p_affectation_id: d.affectation_id, p_lignes: null,
            p_modele: MODELE, p_erreur: 'document illisible ou sans ligne',
          })
          resultats.push({ id: d.affectation_id, erreur: 'illisible' })
          continue
        }

        const r = await rpc('enregistrer_extraction', {
          p_affectation_id: d.affectation_id,
          p_lignes: lu.lignes,
          p_modele: MODELE,
          p_erreur: null,
        })
        resultats.push({ id: d.affectation_id, lignes: (r as { lignes?: number })?.lignes ?? 0 })
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 300)
        await rpc('enregistrer_extraction', {
          p_affectation_id: d.affectation_id, p_lignes: null,
          p_modele: MODELE, p_erreur: msg,
        }).catch(() => undefined)
        resultats.push({ id: d.affectation_id, erreur: msg })
      }
    }

    return json({ ok: true, traites: resultats.length, resultats }, 200, CORS)
  } catch (e) {
    console.error('devis-corpus', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
