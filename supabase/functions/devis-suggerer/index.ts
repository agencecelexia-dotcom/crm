// Edge Function : propose les lignes d'un devis à partir du dossier.
//
// « En fonction de ce qui s'est dit pendant les appels, il clique et ça met la
// ligne. » On rassemble donc trois sources :
//
//   1. le CHANTIER — demande initiale, métier, et surtout l'historique des
//      échanges, où se trouve le détail utile ;
//   2. la BIBLIOTHÈQUE de l'artisan — ses propres lignes, avec ses prix ;
//   3. le RÉFÉRENTIEL — ce qu'on met habituellement sur ce type de devis,
//      extrait des devis réels (0133).
//
// LA RÈGLE QUI COMPTE
//
// Le modèle ne fixe JAMAIS un prix. Il choisit des désignations et estime des
// quantités ; les prix viennent des catalogues qu'on lui fournit, ou restent
// vides. Un prix inventé par une IA, c'est un devis à trois fois le marché —
// exactement ce qui a fait perdre Carole Ledent.

const MODELE = 'claude-sonnet-5'

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

async function rpc(nom: string, params: unknown) {
  const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cle, authorization: `Bearer ${cle}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status}`)
  return await res.json()
}

const OUTIL = {
  name: 'proposer_lignes',
  description: 'Propose les lignes de prestation à faire figurer sur le devis.',
  input_schema: {
    type: 'object',
    properties: {
      lignes: {
        type: 'array',
        description: 'De 3 à 12 lignes, dans l’ordre logique d’exécution du chantier.',
        items: {
          type: 'object',
          properties: {
            designation: {
              type: 'string',
              description:
                "Libellé précis, avec le matériau ou la technique quand le dossier les "
                + "donne. Reprends À L'IDENTIQUE une désignation du catalogue fourni "
                + "quand elle correspond : c'est ce qui permet de lui rattacher un prix.",
            },
            unite: { type: 'string', description: 'm2, ml, u, forfait, h, m3.' },
            quantite: {
              type: 'number',
              description:
                "Estimation à partir du dossier (surface annoncée, longueur, nombre). "
                + "Mets 1 si rien ne permet de l'estimer — l'artisan corrigera.",
            },
            prix_unitaire: {
              type: 'number',
              description:
                "UNIQUEMENT si la désignation vient d'un catalogue fourni : recopie son "
                + "prix. Sinon laisse vide. N'invente JAMAIS un prix, ne le déduis pas "
                + "d'une autre ligne, ne l'estime pas d'après le budget.",
            },
            source: {
              type: 'string',
              enum: ['bibliotheque', 'reference', 'aucune'],
              description: "D'où vient le prix, ou 'aucune' s'il n'y en a pas.",
            },
            pourquoi: {
              type: 'string',
              description:
                "En une courte phrase, ce qui justifie cette ligne — idéalement ce que "
                + "le client a dit. Ex. « il a parlé d'une façade nord en pierre ».",
            },
          },
          required: ['designation', 'unite', 'quantite', 'source'],
        },
      },
      manques: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Ce qu'il faudrait savoir pour chiffrer sérieusement et qui n'est pas au "
          + "dossier (surface exacte, état du support, accès). Trois au maximum.",
      },
    },
    required: ['lignes'],
  },
}

const CONSIGNE = `Tu aides un artisan du bâtiment à préparer un devis, à partir de son dossier client.

Tu proposes des LIGNES DE PRESTATION. Tu ne fixes pas de prix.

Comment travailler :

1. PARS DE CE QUI A ÉTÉ DIT. L'historique des échanges vaut mieux que la description initiale : c'est là que le client précise ce qu'il veut vraiment. Si un échange dit « finalement il ne veut plus le portail », n'inscris pas le portail.

2. N'OUBLIE PAS CE QUI SE FACTURE TOUJOURS. Un chantier réel comporte des lignes que le client ne demande pas mais qui se paient : installation et location d'échafaudage, protection des abords, évacuation des gravats en déchetterie, mise en sécurité. C'est leur absence qui rend un devis incomplet — et incomparable face à un concurrent qui les a mises.

3. RECOPIE LES DÉSIGNATIONS DU CATALOGUE quand elles correspondent, mot pour mot. C'est ce qui permet de rattacher un prix connu à la ligne. N'invente une désignation que si rien ne convient.

4. LES PRIX NE S'INVENTENT PAS. Tu ne recopies que ceux du catalogue. Pas de règle de trois à partir du budget annoncé, pas de moyenne, pas d'estimation « raisonnable ». Une ligne sans prix est utile ; une ligne au mauvais prix fait perdre l'affaire.

5. LES QUANTITÉS S'ESTIMENT, et tu dis d'où elles viennent. « 88 m² » si le dossier parle de 88 m². Sinon 1, et l'artisan corrigera sur place.

Tu écris pour un artisan pressé, sur un téléphone. Sois concret.`

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const cle = Deno.env.get('ANTHROPIC_API_KEY')
    if (!cle) return json({ ok: false, error: 'cle_absente' }, 500, CORS)

    const { token, affectation_token } = await req.json()
    if (typeof token !== 'string' || typeof affectation_token !== 'string') {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }

    const ctx = await rpc('contexte_devis_by_token', {
      p_token: token,
      p_affectation_token: affectation_token,
    }) as { ok: boolean; error?: string; metier?: string }
    if (!ctx?.ok) return json({ ok: false, error: ctx?.error ?? 'contexte_absent' }, 404, CORS)

    // Les deux catalogues. Le référentiel applique lui-même la règle de
    // confidentialité : un artisan n'y voit pas les prix d'un autre.
    const [bibliotheque, reference] = await Promise.all([
      rpc('prix_artisan_by_token', { p_token: token }),
      rpc('reference_by_token', { p_token: token, p_metier: ctx.metier ?? null }),
    ])

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 3000,
        system: CONSIGNE,
        tools: [OUTIL],
        tool_choice: { type: 'tool', name: 'proposer_lignes' },
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text:
              `DOSSIER DU CHANTIER\n${JSON.stringify(ctx, null, 1)}\n\n`
              + `CATALOGUE DE L'ARTISAN (ses prix — à privilégier)\n`
              + `${JSON.stringify(bibliotheque, null, 1)}\n\n`
              + `RÉFÉRENTIEL (lignes habituelles du métier ; "prix_median" absent = prix inconnu, laisse vide)\n`
              + `${JSON.stringify(reference, null, 1)}`,
          }],
        }],
      }),
    })

    if (!res.ok) {
      console.error('anthropic', res.status, await res.text())
      return json({ ok: false, error: 'suggestion_impossible' }, 502, CORS)
    }

    const rep = await res.json()
    const bloc = (rep.content ?? []).find((c: { type: string }) => c.type === 'tool_use')
    if (!bloc) return json({ ok: false, error: 'suggestion_impossible' }, 502, CORS)

    return json({ ok: true, metier: ctx.metier ?? null, ...bloc.input }, 200, CORS)
  } catch (e) {
    console.error('devis-suggerer', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
