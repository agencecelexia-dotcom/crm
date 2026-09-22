// Edge Function : lit une attestation d'assurance et en extrait l'essentiel.
//
// L'artisan dépose son PDF ; Claude en tire l'assureur, le numéro de police et
// la date d'échéance. L'artisan corrige si besoin, l'agence valide ensuite.
//
// POURQUOI FAIRE LIRE PLUTÔT QUE SAISIR
//
// Une attestation de décennale fait deux pages de jargon, et la date qui
// compte s'y cache souvent sous « période de validité ». Demander la saisie
// manuelle, c'est obtenir des champs vides ou faux — et une échéance fausse
// ferme l'accès au chiffrage pour rien, ou le laisse ouvert alors que la
// garantie a expiré.
//
// La clé Anthropic vit dans les secrets Supabase : le bundle front est public.

const MODELE = 'claude-sonnet-5'

// CORS restreint, repris d'`extraire-lead`. `SITE_URL` porte le domaine de
// production : sans lui, seul le développement local fonctionne.
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

/** Formats qu'une attestation peut prendre : PDF scanné, ou photo du document. */
const TYPES_ADMIS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const OUTIL = {
  name: 'enregistrer_attestation',
  description: "Enregistre les informations lues sur l'attestation d'assurance.",
  input_schema: {
    type: 'object',
    properties: {
      type_document: {
        type: 'string',
        enum: ['decennale', 'rc_pro', 'les_deux', 'autre'],
        description:
          "Nature de la garantie attestée. 'les_deux' quand un même document couvre la "
          + "responsabilité décennale ET la responsabilité civile professionnelle, ce qui "
          + "est fréquent. 'autre' si ce n'est pas une attestation d'assurance.",
      },
      assureur: {
        type: 'string',
        description:
          "Nom de la compagnie d'assurance (AXA, MAAF, SMABTP, Groupama…), pas celui du "
          + "courtier ni de l'agence locale quand les deux figurent. Vide si illisible.",
      },
      numero_police: {
        type: 'string',
        description: "Numéro de contrat ou de police. Vide si absent.",
      },
      echeance: {
        type: 'string',
        description:
          "Date de FIN de validité, au format AAAA-MM-JJ. C'est la date jusqu'à laquelle "
          + "la garantie court — souvent présentée comme « valable jusqu'au », « période du "
          + "… au … » (prendre la seconde), ou « échéance ». Ne JAMAIS renvoyer la date "
          + "d'émission du document. Vide si aucune date de fin ne figure.",
      },
      assure: {
        type: 'string',
        description: "Raison sociale de l'entreprise assurée, telle qu'écrite. Vide si absente.",
      },
      activites: {
        type: 'string',
        description:
          "Activités couvertes, résumées en une ligne (ex. « couverture, zinguerie, "
          + "charpente »). C'est ce qui dit si l'artisan est couvert pour ce qu'il fait.",
      },
      confiance: {
        type: 'number',
        description:
          "0 à 1. Sois sévère sur la date et le numéro de police : un scan de travers ou "
          + "une photo floue rendent les chiffres peu fiables. Sous 0.7, l'artisan sera "
          + "invité à vérifier lui-même.",
      },
    },
    required: ['type_document', 'confiance'],
  },
}

const CONSIGNE = `Tu lis une attestation d'assurance d'une entreprise du bâtiment française.

Tu n'as qu'un travail : en extraire l'assureur, le numéro de police, la date de FIN de validité, l'assuré et les activités couvertes.

Trois pièges à éviter :

1. LA DATE. Une attestation porte souvent plusieurs dates : celle d'émission, celle de début de période, celle de fin. Seule la FIN compte. « Valable du 01/01/2026 au 31/12/2026 » → 2026-12-31. Si le document dit seulement « échéance annuelle au 1er avril » sans année, prends la prochaine occurrence à venir.

2. L'ASSUREUR CONTRE LE COURTIER. « Établi par le cabinet Dupont pour le compte de SMABTP » : l'assureur est SMABTP.

3. LA NATURE DE LA GARANTIE. « Responsabilité décennale » et « RC professionnelle » sont deux choses différentes, souvent réunies sur le même papier. Dans ce cas, réponds 'les_deux'.

Si le document n'est pas une attestation d'assurance — une facture, un Kbis, une page blanche — réponds type_document = 'autre' avec une confiance basse. N'invente jamais une date ni un numéro.`

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const cle = Deno.env.get('ANTHROPIC_API_KEY')
    if (!cle) return json({ ok: false, error: 'cle_absente' }, 500, CORS)

    const { token, fichier, mime } = await req.json()

    // L'appelant est l'artisan lui-même, sans compte : son jeton d'espace fait
    // l'authentification, comme partout ailleurs dans le portail.
    if (typeof token !== 'string' || token.length < 16) {
      return json({ ok: false, error: 'token_invalide' }, 401, CORS)
    }
    const sb = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/token_artisan_valide`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
        },
        body: JSON.stringify({ p_token: token }),
      },
    )
    if ((await sb.json()) !== true) {
      return json({ ok: false, error: 'token_invalide' }, 401, CORS)
    }

    if (typeof fichier !== 'string' || !fichier) {
      return json({ ok: false, error: 'fichier_absent' }, 400, CORS)
    }
    if (!TYPES_ADMIS.includes(mime)) {
      return json({ ok: false, error: 'format_non_supporte', formats: TYPES_ADMIS }, 400, CORS)
    }

    // Garde-fou de taille : au-delà, l'appel coûte cher pour rien et l'API
    // refuse. 8 Mo de base64 ≈ 6 Mo de fichier, largement assez pour un scan.
    if (fichier.length > 8_000_000) {
      return json({ ok: false, error: 'fichier_trop_lourd' }, 413, CORS)
    }

    const piece =
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: mime, data: fichier } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: fichier } }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 1000,
        system: CONSIGNE,
        tools: [OUTIL],
        // `tool_use` garantit du JSON valide : pas de texte libre à parser,
        // qui casse dès que le modèle ajoute une phrase autour.
        tool_choice: { type: 'tool', name: 'enregistrer_attestation' },
        messages: [{ role: 'user', content: [piece] }],
      }),
    })

    if (!res.ok) {
      console.error('anthropic', res.status, await res.text())
      return json({ ok: false, error: 'lecture_impossible' }, 502, CORS)
    }

    const rep = await res.json()
    const bloc = (rep.content ?? []).find((c: { type: string }) => c.type === 'tool_use')
    if (!bloc) return json({ ok: false, error: 'lecture_impossible' }, 502, CORS)

    return json({ ok: true, ...bloc.input }, 200, CORS)
  } catch (e) {
    console.error('assurance-lire', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
