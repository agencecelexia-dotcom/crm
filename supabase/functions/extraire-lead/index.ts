// Edge Function : extraction d'un lead depuis la transcription d'un appel.
//
// Appelée en continu pendant l'appel (checklist temps réel) puis une dernière
// fois à la fin (mode 'rapport') pour rédiger la description formatée.
//
// La clé Anthropic vit dans les secrets Supabase et n'est JAMAIS exposée au
// front : le bundle est public, une clé qui s'y trouve est volée en heures.
// C'est toute la raison d'être de cette fonction — le navigateur ne parle
// jamais directement à l'API Anthropic.

const MODELE_EXTRACTION = 'claude-sonnet-4-5'
const MODELE_RAPPORT = 'claude-opus-4-5'

// Référentiel métier du CRM (src/lib/constants.ts). L'extraction est contrainte
// à ces valeurs : un métier inventé ne matcherait aucun artisan.
const METIERS = [
  'Clôture', 'Piscine', 'Paysagisme', 'CVC', 'Couverture', 'Maçonnerie',
  'Menuiserie', 'Électricité', 'Plomberie', 'Terrasse', 'Portail', 'Toiture',
  'Isolation', 'Rénovation', 'Peinture', 'Plâtrerie / Placo', 'Carrelage',
  'Façade / Ravalement', 'Solaire / Photovoltaïque',
  'Petits travaux / Multiservices', 'Serrurerie / Métallerie',
]

// CORS restreint. L'audit (A2) relevait `Access-Control-Allow-Origin: *` sur
// upload-devis : on ne le reproduit pas ici.
// `SITE_URL` porte le domaine de production (secret Supabase). Sans lui, seul
// le développement local fonctionne : c'est un échec bruyant et immédiat,
// préférable à un `*` silencieusement permissif.
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

/** Schéma imposé à Claude. `tool_use` garantit du JSON valide — pas de parsing
 *  de texte libre, qui casse dès que le modèle ajoute une phrase autour. */
const OUTIL_EXTRACTION = {
  name: 'enregistrer_lead',
  description: "Enregistre les informations du client extraites de l'appel.",
  input_schema: {
    type: 'object',
    properties: {
      client_nom: { type: 'string', description: 'Prénom et nom, ou nom seul. Vide si non dit.' },
      client_telephone: { type: 'string', description: 'Numéro français, 10 chiffres, sans espaces. Vide si non dit.' },
      client_email: { type: 'string', description: "Email. Vide si non dit. Attention à l'épellation." },
      client_adresse: { type: 'string', description: 'Numéro et rue uniquement, sans ville ni code postal.' },
      client_code_postal: { type: 'string', description: '5 chiffres.' },
      client_ville: { type: 'string' },
      metiers: {
        type: 'array',
        items: { type: 'string', enum: METIERS },
        description: 'Un ou plusieurs métiers du référentiel. Plusieurs si le chantier en croise plusieurs.',
      },
      probleme: { type: 'string', description: 'La demande du client, en une phrase factuelle.' },
      surface: { type: 'string', description: 'Surface ou dimensions, avec unité. Vide si non dit.' },
      sinistre: {
        type: 'string',
        enum: ['aucun', 'degat_des_eaux', 'grele', 'tempete', 'incendie', 'autre', 'inconnu'],
        description: "Nature du sinistre s'il y en a un.",
      },
      assurance: {
        type: 'string',
        enum: ['oui', 'non', 'inconnu'],
        description: 'Déclaration assurance en cours. Pertinent seulement si sinistre.',
      },
      delai: { type: 'string', description: "Urgence ou échéance évoquée par le client." },
      budget: { type: 'string', description: 'Budget évoqué. Vide si non dit.' },
      disponibilite: { type: 'string', description: 'Créneaux proposés par le client pour une visite.' },
      contraintes: {
        type: 'array',
        items: { type: 'string' },
        description: "Contraintes d'accès, matériaux imposés, mitoyenneté, échafaudage, ou tout point bloquant.",
      },
      alertes: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Points techniques ou réglementaires que le commercial doit signaler à l'artisan. "
          + "Exemples : fibrociment posé avant 1997 = risque amiante ; sinistre = devis pour assureur ; "
          + "toiture ancienne non expertisée. N'invente rien : uniquement ce qui découle de l'appel.",
      },
      confiance: {
        type: 'object',
        description:
          "Pour CHAQUE champ rempli, un score de 0 à 1. Sois SÉVÈRE sur les chiffres "
          + "(téléphone, code postal, surface) et les noms propres : la transcription vient d'un "
          + "haut-parleur, les chiffres y sont souvent mal reconnus. En dessous de 0.75 le champ "
          + "sera présenté comme à confirmer.",
        additionalProperties: { type: 'number' },
      },
    },
    required: ['confiance'],
  },
}

const CONSIGNE = `Tu assistes un commercial de Celexia (courtage en travaux) pendant un appel téléphonique avec un client particulier.

La transcription vient d'un micro en haut-parleur : elle est IMPARFAITE. Mots coupés, chiffres mal reconnus, homophones.

Règles :
1. N'extrais QUE ce qui a été réellement dit. N'invente jamais une valeur plausible.
2. Un champ non abordé reste VIDE. Le commercial doit voir ce qu'il lui reste à demander.
3. Les chiffres dictés à l'oral ("zéro six, onze, soixante-six...") doivent être reconstitués en chiffres.
4. Un numéro français a 10 chiffres. Si tu en comptes un nombre différent, remplis quand même mais mets une confiance BASSE.
5. Pour les emails, attention aux épellations ("arobase", "point com").
6. Les alertes servent à protéger le chantier : signale l'amiante possible (fibrociment ou toiture-fibro d'avant 1997), un devis destiné à un assureur, un accès impossible, des matériaux imposés.
7. Sois sévère sur la confiance. Un champ à 0.9 sera considéré comme acquis par le commercial.`

const CONSIGNE_RAPPORT = `Tu rédiges la fiche projet d'un CRM à partir d'un appel client.

Format EXACT, toujours identique (n'ajoute aucun titre, aucune conclusion) :

Première ligne : la demande en une phrase factuelle.

Puis, seulement si l'information existe, ces blocs séparés par une ligne vide :
- Contexte : ancienneté du bien, historique des travaux, ce qui a déjà été tenté.
- Contraintes : accès, mitoyenneté, matériaux imposés, échafaudage.
- Disponibilité : créneaux donnés par le client.
- À VÉRIFIER — <sujet> : ce qui reste à confirmer, en majuscules pour le mot-clé.

Style : phrases courtes, factuelles, pas d'adjectif commercial, pas de "le client souhaite" répété.
N'invente aucune information absente de la transcription.`

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const CORS = cors(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { transcription, mode = 'extraction', donnees } = await req.json()

    if (typeof transcription !== 'string' || transcription.trim().length < 10) {
      return json({ ok: false, error: 'transcription trop courte' }, 400, CORS)
    }
    // Garde-fou de coût : un appel d'une heure ne doit pas partir en entier.
    const texte = transcription.slice(-12_000)

    const cle = Deno.env.get('ANTHROPIC_API_KEY')
    if (!cle) return json({ ok: false, error: 'clé API non configurée' }, 500, CORS)

    if (mode === 'rapport') {
      const r = await anthropic(cle, {
        model: MODELE_RAPPORT,
        max_tokens: 1200,
        system: CONSIGNE_RAPPORT,
        messages: [{
          role: 'user',
          content: `Transcription de l'appel :\n\n${texte}\n\n`
            + `Informations déjà extraites :\n${JSON.stringify(donnees ?? {}, null, 2)}\n\n`
            + `Rédige la fiche.`,
        }],
      })
      const description = r.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
      return json({ ok: true, description }, 200, CORS)
    }

    const r = await anthropic(cle, {
      model: MODELE_EXTRACTION,
      max_tokens: 2000,
      system: CONSIGNE,
      tools: [OUTIL_EXTRACTION],
      tool_choice: { type: 'tool', name: 'enregistrer_lead' },
      messages: [{ role: 'user', content: `Transcription en cours :\n\n${texte}` }],
    })

    const bloc = r.content?.find((c: { type: string }) => c.type === 'tool_use')
    if (!bloc) return json({ ok: false, error: 'extraction vide' }, 502, CORS)

    return json({ ok: true, lead: bloc.input }, 200, CORS)
  } catch (e) {
    console.error('extraire-lead', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})

async function anthropic(cle: string, body: unknown) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status} : ${await res.text()}`)
  return await res.json()
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}
