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
                'Le libellé de la ligne. Reprends celui du catalogue MOT POUR MOT lorsque le '
                + 'catalogue décrit EXACTEMENT ce travail ; sinon écris le tien. Sans l’unité, '
                + 'qui a son propre champ.',
            },
            prix_id: {
              type: 'string',
              description:
                'L’identifiant entre crochets de la ligne de catalogue que tu reprends, et '
                + 'seulement si elle désigne EXACTEMENT le même travail. C’est lui, et lui seul, '
                + 'qui rattache un prix à la ligne. En cas de doute, ne le donne pas : une ligne '
                + 'sans prix se voit et se complète, un prix faux passe inaperçu et fait perdre '
                + 'l’affaire.',
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

1 bis. JAMAIS DE QUESTION SUR LE BUDGET. Même si la description en annonce un, tu l'ignores : le prix se calcule à partir des tarifs de l'artisan, jamais à partir de ce que le client est prêt à mettre. Demander « le budget est-il un plafond ? » oriente le chiffrage et détruit la seule chose qui fasse la valeur de ce devis.

1 ter. SI LA DESCRIPTION SE CONTREDIT — deux surfaces différentes, deux matériaux incompatibles — pose la question du choix, avec les deux valeurs en options. Ne tranche jamais en silence.

2. JAMAIS CE QUE TU SAIS DÉJÀ. Si la description ou le dossier donne la surface, ne la redemande pas. Poser une question dont la réponse est sous ses yeux lui fait perdre confiance dans les autres.

3. SEPT AU MAXIMUM, et la plus déterminante en premier. Il répond debout, sur un téléphone, souvent devant le client.

4. PRÉFÈRE LE CHOIX AU TEXTE. Trois pastilles à toucher valent mieux qu'une phrase à taper. Le texte libre est un dernier recours.

5. PROPOSE UN DÉFAUT JUSTE. La plupart des réponses seront conservées telles quelles : un défaut bien choisi fait gagner autant qu'une question bien posée.

6. VOUVOIE, TOUJOURS ET PARTOUT. Pas un « tu » isolé au milieu de questions qui vouvoient.

Tu écris comme on parle sur un chantier : court, concret, sans jargon administratif.`

const CONSIGNE_LIGNES =
  `Tu composes les lignes du devis d'un artisan du bâtiment, à partir de sa description et de ses réponses.

Tu ne fixes AUCUN prix : ils sont attachés ensuite, depuis ses propres tarifs. Ton travail est de choisir les bonnes lignes et les bonnes quantités.

Comment travailler :

1. LE CATALOGUE EST UN VOCABULAIRE, PAS UNE LISTE DE COURSES. Il contient les lignes que cet artisan a déjà facturées, sur d'autres chantiers. Tu n'as aucune obligation d'en utiliser une seule. Ne fais figurer un ouvrage que si le chantier décrit le comporte VRAIMENT.

2. NE PLAQUE JAMAIS UN LIBELLÉ SUR UN AUTRE TRAVAIL. « Gouttière (fourniture et pose) » ne désigne pas le nettoyage d'une gouttière ; « Clôture panneaux rigides » ne désigne pas les poteaux qui la tiennent. Si aucune ligne du catalogue ne décrit exactement le travail, écris ta propre désignation et NE DONNE PAS d'identifiant : la ligne arrivera sans prix, l'artisan le saisira, et tu auras eu raison. Un libellé détourné apporte avec lui un prix faux, que personne ne remarque et qui fait perdre l'affaire.

3. L'IDENTIFIANT ENGAGE. Ne rends l'identifiant d'une ligne de catalogue que si elle décrit exactement le même ouvrage, dans la même unité. C'est lui seul qui attache un prix.

4. N'OUBLIE PAS CE QUI SE FACTURE TOUJOURS — mais seulement ce que CE chantier appelle. Un ravalement demande un échafaudage, une protection des abords et une évacuation ; un simple nettoyage de gouttières n'en demande aucun. C'est l'absence de ces lignes qui rend un devis de chantier incomplet, et leur présence injustifiée qui le rend suspect.

5. UN OUVRAGE, UNE LIGNE. Le catalogue contient souvent plusieurs formulations du même travail : « Installation échafaudage » et « Montage et démontage d'échafaudage de pied » sont la même chose, et la facturer deux fois double une ligne qui pèse plus de mille euros. Choisis la formulation la plus complète, et une seule. Cela vaut pour l'échafaudage, l'évacuation des gravats et le nettoyage de fin de chantier, qui reviennent tous sous deux ou trois libellés.

6. RANGE DANS L'ORDRE DES TRAVAUX. Un devis se lit comme le chantier se déroule : installation, préparation, exécution, finitions, repli.

7. REPORTE LES QUANTITÉS. Une surface de façade annoncée vaut pour le nettoyage, le piquage, le gobetis et l'enduit. Ne la redivise pas sans raison.

8. RESPECTE LES RÉPONSES. Une réponse de l'artisan n'est pas une suggestion : si le terrain est annoncé plat, il n'y a pas de ligne de terrassement ; si la réparation est choisie plutôt que le remplacement, tu ne chiffres pas un ouvrage neuf. Et n'écris pas qu'une valeur est « confirmée » quand personne ne l'a confirmée.

9. GARDE LES MÊMES LIBELLÉS. Sur un même chantier, la formulation d'une ligne ne doit pas changer d'une composition à l'autre : c'est elle qui permet d'y rattacher un prix connu. Reprends le catalogue à l'identique dès qu'il convient.

10. DIS CE QUE TU AS SUPPOSÉ. Toute quantité qui ne découle pas d'une réponse est une hypothèse, et l'artisan doit pouvoir la démentir avant d'envoyer.`

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
    // Garde-fou de coût : une description n'est pas un roman.
    if (description.length > 4000) {
      return json({ ok: false, error: 'description_trop_longue' }, 400, CORS)
    }

    // CLAUDE EST PAYANT : ON NE L'APPELLE QUE POUR UN ARTISAN HABILITÉ.
    //
    // Avec un jeton invalide, les lectures du catalogue renvoyaient une liste
    // vide sans erreur, et l'appel partait quand même : la seule clé publique
    // du bundle suffisait à faire travailler le modèle aux frais de l'agence.
    // Le jeton doit désigner un artisan actif ET autorisé à chiffrer (ses
    // assurances déposées et validées) — la même règle que le générateur.
    const etat = await rpc('etat_chiffrage_by_token', { p_token: token }) as
      { peut_chiffrer?: boolean } | null
    if (etat?.peut_chiffrer !== true) {
      return json({ ok: false, error: 'non_autorise' }, 403, CORS)
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
    // Les lignes de SA bibliothèque portent un identifiant : c'est par lui, et
    // non plus par ressemblance de libellé, que le prix est rattaché.
    const designations = [
      ...(Array.isArray(biblio) ? biblio : []).map(
        (x: { id: string; designation: string; unite: string }) =>
          `[${x.id}] ${x.designation}\t${x.unite ?? ''}`,
      ),
      // Le référentiel n'a pas d'identifiant : ses libellés viennent des devis
      // observés, et son prix est une médiane de métier.
      ...(Array.isArray(reference) ? reference : []).map(
        (x: { designation: string; unite: string }) => `${x.designation}\t${x.unite ?? ''}`,
      ),
    ]

    const questions = phase === 'questions'
    const contexte =
      `CE QUE L'ARTISAN DÉCRIT\n${description.trim()}\n\n`
      + (metierRetenu ? `MÉTIER\n${metierRetenu}\n\n` : '')
      + (ctx ? `DOSSIER DU CHANTIER\n${JSON.stringify(ctx, null, 1)}\n\n` : '')
      + (questions
        ? ''
        : `RÉPONSES DE L'ARTISAN\n${JSON.stringify(reponses ?? {}, null, 1)}\n\n`)
      + `CATALOGUE (identifiant entre crochets quand il y en a un, puis désignation, puis unité,\n`
      + `séparées par une tabulation ; recopie la désignation SEULE, sans l'unité)\n`
      + `${designations.join('\n') || '(vide)'}`

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
