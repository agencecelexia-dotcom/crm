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
      nature_appel: {
        type: 'string',
        enum: ['client', 'artisan_cherche_travail', 'demarchage', 'indetermine'],
        description:
          "Qui est au bout du fil, c'est-à-dire l'INTERLOCUTEUR — jamais le commercial de "
          + "Celexia qui se présente en ouverture. 'client' = quelqu'un qui décrit des "
          + "travaux à faire chez lui : c'est le cas par défaut, et de très loin le plus "
          + "fréquent. 'artisan_cherche_travail' = à réserver au cas NON AMBIGU où "
          + "l'interlocuteur demande explicitement du travail ou des chantiers pour "
          + "lui-même, et ne décrit aucun besoin de travaux le concernant. Si "
          + "l'interlocuteur décrit le moindre problème sur son bien, c'est un CLIENT. "
          + "Dans le doute, toujours 'indetermine' — jamais 'artisan_cherche_travail'.",
      },
      artisan_metier: {
        type: 'string',
        description:
          "Si nature_appel = artisan_cherche_travail : son métier et sa zone, pour un "
          + "recrutement éventuel. Vide sinon.",
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

const CONSIGNE = `Tu assistes un commercial de Celexia (courtage en travaux) pendant un appel téléphonique avec un client particulier. Tu écoutes une transcription automatique IMPARFAITE, produite par un micro en haut-parleur.

Ton travail n'est pas de recopier la transcription : c'est de COMPRENDRE la conversation et d'en tirer les informations justes. Le commercial ne doit pas avoir à corriger derrière toi.

RAISONNE COMME UN HUMAIN QUI ÉCOUTE :

1. LES REPRISES ANNULENT CE QUI PRÉCÈDE. « c'est obligeant... non, AUBIGEON » : le nom est Aubigeon. « le 06 12 34 56 78, ah pardon, le 06 87 00 37 30 » : garde le second. La dernière version énoncée l'emporte TOUJOURS.

2. UNE ÉPELLATION FAIT AUTORITÉ. Si le client épelle (« A-U-B-I-G-E-O-N », « comme Lancelot »), c'est la vérité, quelle que soit la transcription phonétique qui précède. Confiance haute.

3. LA TRANSCRIPTION EST PHONÉTIQUE. Un mot qui n'a aucun sens dans le contexte est presque toujours un nom propre mal reconnu. « obligeant » au milieu de « qui écrit ... c'est ça », dans une phrase où on demande un nom, est un NOM, pas un adjectif. Reconstitue-le, et baisse la confiance si tu n'es pas sûr.

4. MÉFIE-TOI DES MOTS TRONQUÉS. La transcription arrive par morceaux : un mot en fin de texte peut être coupé (« Aubi » pour « Aubigeon », « Saint-Rome-de » pour « Saint-Rome-de-Cernon »). Un nom de 3-5 lettres sans terminaison plausible est probablement incomplet : mets une confiance BASSE (0.3) pour que le commercial le confirme. NE COMPLÈTE JAMAIS par une invention.

5. LES CHIFFRES DICTÉS. « zéro six, treize, soixante-dix-sept » = 0613 77... Un numéro français a 10 chiffres. Si le compte ne tombe pas juste, remplis quand même mais confiance BASSE.

6. LES EMAILS S'ÉPELLENT. « arobase » = @, « point com » = .com, « tiret » = -, « underscore » = _. Colle les morceaux sans ajouter de point qui n'a pas été dit.

7. GÉOGRAPHIE FRANÇAISE. Un code postal et une ville doivent être cohérents. « syndrome de Cernon » à côté du 12490 est « Saint-Rome-de-Cernon ». Utilise ta connaissance des communes pour rétablir les noms écorchés, mais baisse la confiance si tu extrapoles.

8. TU AS DÉJÀ EXTRAIT CET APPEL. Si un état antérieur t'est fourni, ne le jette pas : la nouvelle transcription est plus longue, pas différente. Conserve un champ déjà obtenu SAUF si le client s'est corrigé depuis. Un champ qui disparaît de ta réponse est une régression pour le commercial.

DEUX PERSONNES PARLENT, NE LES CONFONDS JAMAIS.

Le COMMERCIAL de Celexia se présente en ouverture : « bonjour, Antoine, société Batryx Construction, on fait de la toiture ». C'est LUI qui parle de son entreprise, de son métier, de ce qu'il propose. Ces phrases ne décrivent PAS le client et ne doivent JAMAIS être extraites comme des informations sur lui.

Le CLIENT est celui qui décrit un problème sur SON bien : « j'ai une lauze qui est tombée du toit », « il faudrait remettre », « c'est sur une partie de la toiture ». C'est de lui seul que viennent nom, téléphone, adresse et demande.

Règle pratique : tout ce qui est dit AVANT que le client expose son besoin est de la présentation commerciale. Une entreprise citée en ouverture est celle de l'appelant, pas celle du client.

RÈGLE ABSOLUE : n'invente jamais une valeur plausible. Un champ non abordé reste VIDE — le commercial doit voir ce qu'il lui reste à demander. Mieux vaut un champ vide qu'un champ faux.

CONFIANCE : 0.9+ = entendu clairement ou épellé. 0.7-0.85 = compris mais reconstitué. 0.3-0.6 = deviné, tronqué, ou chiffres douteux. Sois SÉVÈRE : au-dessus de 0.75 le commercial considère l'information comme acquise et ne la vérifiera pas.`

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
      messages: [{
        role: 'user',
        content: donnees
          // Sans l'état antérieur, chaque extraction repart de zéro : un champ
          // capté à la minute 2 pouvait disparaître à la minute 3.
          ? `Tu avais déjà extrait ceci :\n${JSON.stringify(donnees, null, 2)}\n\n`
            + `Transcription complète mise à jour :\n\n${texte}\n\n`
            + `Reprends l'extraction. Conserve ce qui reste valable, corrige ce que le client a rectifié depuis, complète ce qui manquait.`
          : `Transcription en cours :\n\n${texte}`,
      }],
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
