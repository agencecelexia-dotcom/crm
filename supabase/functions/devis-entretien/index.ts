// Edge Function : le devis par entretien.
//
// La seconde porte d'entrée du générateur. Plutôt que de remplir des lignes,
// l'artisan DÉCRIT son chantier ; on lui pose les questions qui changent le
// prix ; le devis en sort chiffré.
//
// DEUX PHASES
//
//   1. `questions` — le modèle lit la description et le dossier, et demande ce
//      qui manque pour chiffrer : surfaces, hauteurs, état du support, accès.
//      Jamais ce que le dossier dit déjà.
//   2. `lignes` — muni des réponses, il compose les lignes du devis.
//
// LE PRIX NE PASSE PAS PAR LE MODÈLE
//
// `devis-suggerer` lui interdit d'inventer un prix par CONSIGNE. Une consigne
// se contourne. Ici, le modèle n'a aucun prix sous les yeux et son outil n'a
// pas de champ de prix : il ne PEUT pas en produire.
//
// Les prix sont attachés ensuite par `garnir_lignes_by_token` (0140), depuis
// la bibliothèque de l'artisan puis le référentiel du métier, et la marge
// visée est appliquée là où le déboursé est connu. Ce qui ne trouve preneur
// nulle part revient « à chiffrer » — une case vide se voit, un prix faux non.

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

const OUTIL_QUESTIONS = {
  name: 'poser_questions',
  description: 'Pose les questions dont les réponses changent le prix du devis.',
  input_schema: {
    type: 'object',
    properties: {
      objet: {
        type: 'string',
        description: 'Objet du devis, en cinq mots. Ex. « Ravalement de façade ».',
      },
      questions: {
        type: 'array',
        description: 'De 3 à 7 questions, la plus déterminante en premier.',
        items: {
          type: 'object',
          properties: {
            cle: {
              type: 'string',
              description: 'Identifiant court, en minuscules, sans espace. Ex. surface_facade.',
            },
            libelle: {
              type: 'string',
              description: 'La question, en une ligne, telle qu’on la poserait de vive voix.',
            },
            type: {
              type: 'string',
              enum: ['nombre', 'choix', 'texte'],
              description:
                'nombre quand la réponse est une quantité ; choix quand elle tient en quelques '
                + 'possibilités ; texte en dernier recours — il faut alors taper au clavier.',
            },
            unite: { type: 'string', description: 'Pour un nombre : m², ml, m³, u, h.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Pour un choix : de 2 à 5 réponses, courtes.',
            },
            defaut: {
              type: 'string',
              description: 'La réponse la plus probable, pré-remplie. Fais-la juste : elle sera '
                + 'souvent conservée telle quelle.',
            },
            pourquoi: {
              type: 'string',
              description: 'Ce que la réponse change au devis, en une phrase courte.',
            },
          },
          required: ['cle', 'libelle', 'type'],
        },
      },
    },
    required: ['questions'],
  },
}

const OUTIL_LIGNES = {
  name: 'composer_devis',
  description:
    'Compose les lignes du devis. Aucun prix : ils sont attachés ensuite par le système.',
  input_schema: {
    type: 'object',
    properties: {
      objet: { type: 'string', description: 'Objet du devis, en cinq mots.' },
      lignes: {
        type: 'array',
        description: 'De 4 à 14 lignes, dans l’ordre d’exécution du chantier.',
        items: {
          type: 'object',
          properties: {
            designation: {
              type: 'string',
              description:
                'Recopie MOT POUR MOT la désignation du catalogue quand elle convient : c’est ce '
                + 'qui permet d’y rattacher un prix connu. Sans l’unité, qui a son propre champ.',
            },
            unite: { type: 'string', description: 'm², ml, m³, u, forfait, h, j, ens.' },
            quantite: {
              type: 'number',
              description:
                'Déduite des réponses. Une surface de façade se reporte telle quelle sur le '
                + 'nettoyage, le piquage, le gobetis et l’enduit.',
            },
            pourquoi: {
              type: 'string',
              description: 'D’où vient la quantité, en quelques mots. Ex. « 118 m² annoncés ».',
            },
          },
          required: ['designation', 'unite', 'quantite'],
        },
      },
      hypotheses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ce que tu as supposé faute de réponse. L’artisan doit pouvoir le démentir.',
      },
      manques: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ce qui reste à vérifier sur place avant d’envoyer.',
      },
    },
    required: ['lignes'],
  },
}

const CONSIGNE_QUESTIONS =
  `Tu prépares le devis d'un artisan du bâtiment. Il vient de décrire son chantier ; tu lui poses les questions qui manquent pour le chiffrer.

Comment choisir tes questions :

1. UNIQUEMENT CE QUI CHANGE LE PRIX. Une surface, une hauteur, un état de support, un accès, une finition. Pas le nom du client, pas la date, pas ce qui relève de l'organisation.

2. JAMAIS CE QUE TU SAIS DÉJÀ. Si la description ou le dossier donne la surface, ne la redemande pas. Poser une question dont la réponse est sous ses yeux lui fait perdre confiance dans les autres.

3. SEPT AU MAXIMUM, et la plus déterminante en premier. Il répond debout, sur un téléphone, souvent devant le client.

4. PRÉFÈRE LE CHOIX AU TEXTE. Trois pastilles à toucher valent mieux qu'une phrase à taper. Le texte libre est un dernier recours.

5. PROPOSE UN DÉFAUT JUSTE. La plupart des réponses seront conservées telles quelles : un défaut bien choisi fait gagner autant qu'une question bien posée.

Tu écris comme on parle sur un chantier : court, concret, sans jargon administratif.`

const CONSIGNE_LIGNES =
  `Tu composes les lignes du devis d'un artisan du bâtiment, à partir de sa description et de ses réponses.

Tu ne fixes AUCUN prix : ils sont attachés ensuite, depuis ses propres tarifs. Ton travail est de choisir les bonnes lignes et les bonnes quantités.

Comment travailler :

1. RECOPIE LES DÉSIGNATIONS DU CATALOGUE mot pour mot quand elles conviennent. C'est ce qui permet d'y rattacher un prix connu. N'invente une désignation que si rien ne correspond.

2. N'OUBLIE PAS CE QUI SE FACTURE TOUJOURS. Un chantier réel comporte des lignes que le client ne demande jamais mais qui se paient : installation et location d'échafaudage, protection des abords, évacuation des gravats en déchetterie, mise en sécurité, nettoyage de fin de chantier. C'est leur absence qui rend un devis incomplet.

3. UN OUVRAGE, UNE LIGNE. Le catalogue contient souvent plusieurs formulations du même travail : « Installation échafaudage » et « Montage et démontage d'échafaudage de pied » sont la même chose, et la facturer deux fois double une ligne qui pèse plus de mille euros. Choisis la formulation la plus complète, et une seule. Cela vaut pour l'échafaudage, l'évacuation des gravats et le nettoyage de fin de chantier, qui reviennent tous sous deux ou trois libellés.

4. RANGE DANS L'ORDRE DES TRAVAUX. Un devis se lit comme le chantier se déroule : installation, préparation, exécution, finitions, repli.

5. REPORTE LES QUANTITÉS. Une surface de façade annoncée vaut pour le nettoyage, le piquage, le gobetis et l'enduit. Ne la redivise pas sans raison.

6. DIS CE QUE TU AS SUPPOSÉ. Toute quantité qui ne découle pas d'une réponse est une hypothèse, et l'artisan doit pouvoir la démentir avant d'envoyer.`

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const cle = Deno.env.get('ANTHROPIC_API_KEY')
    if (!cle) return json({ ok: false, error: 'cle_absente' }, 500, CORS)

    const body = await req.json()
    const { token, phase, description, affectation_token, metier, reponses, marge } = body ?? {}

    if (typeof token !== 'string' || (phase !== 'questions' && phase !== 'lignes')) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    if (typeof description !== 'string' || description.trim().length < 10) {
      return json({ ok: false, error: 'description_trop_courte' }, 400, CORS)
    }

    // Le dossier, quand le devis part d'un chantier : ce qui s'est dit pendant
    // les appels vaut mieux que la description initiale.
    let ctx: Record<string, unknown> | null = null
    if (typeof affectation_token === 'string' && affectation_token) {
      const r = await rpc('contexte_devis_by_token', {
        p_token: token,
        p_affectation_token: affectation_token,
      }) as { ok: boolean; metier?: string }
      if (r?.ok) ctx = r
    }
    const metierRetenu = (ctx?.metier as string | undefined) ?? (typeof metier === 'string' ? metier : null)

    // Les catalogues, RÉDUITS AUX DÉSIGNATIONS : le modèle n'a pas à connaître
    // les prix pour choisir des lignes, et ce qu'il ignore il ne peut pas
    // l'inventer.
    const [biblio, reference] = await Promise.all([
      rpc('prix_artisan_by_token', { p_token: token }),
      metierRetenu
        ? rpc('reference_by_token', { p_token: token, p_metier: metierRetenu })
        : Promise.resolve([]),
    ])
    // Désignation et unité en DEUX COLONNES : coller « (forfait) » derrière la
    // désignation la ferait recopier telle quelle — la consigne dit mot pour
    // mot, et le modèle obéit.
    const ligneCatalogue = (x: { designation: string; unite: string }) =>
      `${x.designation}\t${x.unite ?? ''}`
    const designations = [
      ...(Array.isArray(biblio) ? biblio : []).map(ligneCatalogue),
      ...(Array.isArray(reference) ? reference : []).map(ligneCatalogue),
    ]

    const questions = phase === 'questions'
    const contexte =
      `CE QUE L'ARTISAN DÉCRIT\n${description.trim()}\n\n`
      + (metierRetenu ? `MÉTIER\n${metierRetenu}\n\n` : '')
      + (ctx ? `DOSSIER DU CHANTIER\n${JSON.stringify(ctx, null, 1)}\n\n` : '')
      + (questions
        ? ''
        : `RÉPONSES DE L'ARTISAN\n${JSON.stringify(reponses ?? {}, null, 1)}\n\n`)
      + `CATALOGUE DES DÉSIGNATIONS UTILISABLES (désignation puis unité, séparées par une tabulation ;\n`
      + `recopie la désignation SEULE, sans l'unité)\n${designations.join('\n') || '(vide)'}`

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
        system: questions ? CONSIGNE_QUESTIONS : CONSIGNE_LIGNES,
        tools: [questions ? OUTIL_QUESTIONS : OUTIL_LIGNES],
        tool_choice: { type: 'tool', name: questions ? 'poser_questions' : 'composer_devis' },
        messages: [{ role: 'user', content: [{ type: 'text', text: contexte }] }],
      }),
    })

    if (!res.ok) {
      console.error('anthropic', res.status, await res.text())
      return json({ ok: false, error: 'entretien_impossible' }, 502, CORS)
    }

    const rep = await res.json()
    const bloc = (rep.content ?? []).find((c: { type: string }) => c.type === 'tool_use')
    if (!bloc) return json({ ok: false, error: 'entretien_impossible' }, 502, CORS)

    if (questions) {
      return json({ ok: true, metier: metierRetenu, ...bloc.input }, 200, CORS)
    }

    // Les prix sont attachés en base, hors de portée du modèle. La marge n'est
    // retenue que si elle tient debout : `garnir_lignes_by_token` écarte
    // d'elle-même tout ce qui sort de l'intervalle 0–80 %.
    const garnies = await rpc('garnir_lignes_by_token', {
      p_token: token,
      p_lignes: bloc.input.lignes ?? [],
      p_metier: metierRetenu,
      p_marge_cible: typeof marge === 'number' ? marge : null,
    }) as { ok: boolean; error?: string; lignes?: unknown[] }

    if (!garnies?.ok) {
      return json({ ok: false, error: garnies?.error ?? 'garniture_impossible' }, 400, CORS)
    }

    return json({
      ok: true,
      metier: metierRetenu,
      objet: bloc.input.objet ?? null,
      lignes: garnies.lignes ?? [],
      // Ce que le modèle a dû supposer, et ce qu'il reste à vérifier : ces deux
      // listes sont ce qui empêche l'artisan d'envoyer un devis qu'il n'a pas lu.
      hypotheses: bloc.input.hypotheses ?? [],
      manques: bloc.input.manques ?? [],
      pourquoi: (bloc.input.lignes ?? []).map((l: { pourquoi?: string }) => l.pourquoi ?? null),
    }, 200, CORS)
  } catch (e) {
    console.error('devis-entretien', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
