// LE MÉTREUR IA : Claude trace la maison sur la photo aérienne, comme le ferait
// un artisan au stylet, et le laser mesure dans ce qu'il a tracé. Sans Deno ni
// réseau : le modèle et les images sont injectés (`Deps`), pour tester la boucle
// avec un faux modèle.
//
// LA BOUCLE
//
// Le modèle voit la vue de dessus (grille chiffrée de 0 à 1000). Il appelle des
// outils : `voir` (une autre vue : relief, quatre vues obliques, une façade),
// `tracer` (l'emprise, les pans, la terrasse, les barrières, les escaliers),
// `supprimer`, `superposer` (la photo avec ses tracés), `terminer`. À chaque
// `tracer`, il reçoit ce que le laser mesure dans ses tracés — pente, surface,
// hauteurs — et les alertes (un « pan » qui ne tient pas dans un plan…) : il
// corrige. Les chiffres sont ceux du laser ; il n'en donne aucun.

import { EST_LIGNE, GENRES_TRACE, accrocher, mesurerTrace, toitNonCouvert, verifierTraces, type Contexte, type MesureTrace, type Trace } from './_traces.ts'
import { vueAvecTraces, type Ortho, type UV } from './_vues-ia.ts'

export type VueDemandee = 'dessus' | 'photo' | 'hauteurs' | 'nord' | 'sud' | 'est' | 'ouest'

export const OUTILS = [
  {
    name: 'voir',
    description:
      "Regarder une vue de la maison. « dessus » : le relief du laser vu de dessus, ombré, avec la grille — c'est sur elle que tu traces. « photo » : la photo aérienne avec la même grille (couleurs, matériaux ; les toits y sont un peu décalés). « hauteurs » : la carte des hauteurs, chaque niveau du terrain teinté. « nord », « sud », « est », « ouest » : la maison vue de ce côté, en oblique.",
    input_schema: {
      type: 'object',
      properties: { vue: { type: 'string', enum: ['dessus', 'photo', 'hauteurs', 'nord', 'sud', 'est', 'ouest'] } },
      required: ['vue'],
      additionalProperties: false,
    },
  },
  {
    name: 'tracer',
    description:
      "Tracer (ou retracer) des objets sur la vue de dessus, en coordonnées de 0 à 1000 (x de gauche à droite, y de haut en bas, lues sur la grille). Un polygone n'a pas besoin de répéter son premier point. Un objet dont l'id existe déjà est remplacé. Le laser mesure chaque tracé et te rend ses chiffres et ses alertes.",
    input_schema: {
      type: 'object',
      properties: {
        objets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: "Un numéro à toi, unique (1, 2, 3…). Le même numéro remplace le tracé précédent." },
              genre: { type: 'string', enum: [...GENRES_TRACE] },
              points: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 }, minItems: 2 },
              note: { type: 'string', description: 'Ce que tu as vu, en une phrase.' },
            },
            required: ['id', 'genre', 'points', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['objets'],
      additionalProperties: false,
    },
  },
  {
    name: 'supprimer',
    description: 'Supprimer des tracés par leur numéro.',
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } } }, required: ['ids'], additionalProperties: false },
  },
  {
    name: 'superposer',
    description: 'Voir la photo aérienne avec tous tes tracés en couleur et leurs numéros, pour vérifier où ils tombent.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'terminer',
    description: 'Rendre le travail : quand la maison est tracée et que les alertes sont réglées ou expliquées.',
    input_schema: {
      type: 'object',
      properties: {
        resume: { type: 'string', description: 'Ce que tu as tracé, en deux phrases.' },
        doutes: { type: 'array', items: { type: 'string' }, description: 'Ce que tu n’as pas pu trancher, ou qui reste douteux.' },
      },
      required: ['resume', 'doutes'],
      additionalProperties: false,
    },
  },
]

export const SYSTEME = [
  "Tu es métreur pour un artisan du bâtiment. Tu traces une maison sur sa photo aérienne, comme au stylet ; un laser (LiDAR) mesure ce que tu as tracé et te rend les chiffres.",
  '',
  "LA VUE SUR LAQUELLE TU TRACES : le relief mesuré par le laser, vu de dessus, ombré (nord en haut), avec une grille chiffrée de 0 à 1000 (x de gauche à droite, y de haut en bas ; un trait tous les 100). Chaque facette de toit y a son ton selon son exposition ; plus c'est chaud, plus c'est haut ; les arbres sont en vert. Tu lis tes coordonnées sur cette grille. Ne trace PAS sur la photo aérienne : ses toits sont décalés d'un ou deux mètres (parallaxe), tes pans tomberaient à côté des points qu'ils doivent mesurer. La photo sert à reconnaître les matériaux, les terrasses, les escaliers. Regarde aussi la carte des hauteurs et les quatre vues obliques (nord, sud, est, ouest) pour comprendre les volumes.",
  '',
  'CE QUE TU TRACES (genre) :',
  "- emprise : le contour des MURS de la maison (au sol, sans le débord du toit). Un polygone, fermé.",
  "- annexe : le contour d'un bâtiment bas collé ou proche (garage, véranda, abri).",
  '- pan : UNE facette plane de toit. Une maison à croupes en a quatre ou plus ; un toit à deux pans en a deux. Le pan comprend le débord du toit. Ne réunis jamais deux facettes qui n’ont pas la même pente ou la même direction.',
  '- terrasse : une dalle plate, sans toit, à un niveau différent du jardin.',
  '- escalier : le polygone de la volée de marches entre deux niveaux.',
  '- mur_soutenement, barriere : des lignes (au moins 2 points).',
  '',
  'COMMENT TRAVAILLER :',
  "0. Si des tracés « proposés par le programme » existent déjà (le premier message les liste, avec leurs mesures), pars d'eux : ils viennent d'un algorithme qui lit les points du laser, souvent juste, parfois faux (deux pans réunis, une terrasse prise pour un toit, un pan oublié, une annexe prise pour la maison). Vérifie-les sur la vue et les obliques, corrige ou supprime ce qui est faux, ajoute ce qui manque : terrasses, escaliers, barrières, annexes. Ne retrace pas ce qui est juste : une mesure sans alerte et qui colle à la vue reste telle quelle.",
  '1. Regarde la vue de dessus, puis les vues obliques et la carte des hauteurs.',
  "2. Trace l'emprise, puis les pans un par un, puis annexes, terrasses, escaliers, barrières.",
  '3. Lis les chiffres que le laser te rend : pente, surface, hauteurs. Une alerte dit qu’un tracé ne va pas (plan mal ajusté, pas de points…) : corrige-le.',
  '4. Appelle superposer, vérifie que chaque tracé colle à ce que tu vois, corrige.',
  "5. Appelle terminer — mais pas tant qu'une ALERTE ou un morceau de toit non couvert reste sans réponse : corrige, ou explique-le dans les doutes.",
  '',
  'RÈGLES :',
  "- Tu ne donnes AUCUN chiffre de mesure (hauteur, surface, pente) : c'est le laser qui mesure ce que tu traces.",
  '- Ne trace que ce que tu vois. Un arbre qui cache un toit : dis-le dans les doutes, ne devine pas.',
  '- Des coins qui se touchent doivent tomber au même endroit : le serveur accroche à 50 cm, mais vise juste.',
  '- Sois économe : quelques tours suffisent.',
].join('\n')

/** Ce que la boucle demande au monde extérieur. */
export interface Deps {
  /** L'appel au modèle (Anthropic `messages.create`). */
  creer: (p: { system: string; tools: typeof OUTILS; messages: Message[] }) => Promise<Reponse>
  /** Les images des vues : PNG, ou null si elle n'existe pas. */
  image: (v: VueDemandee) => Promise<Uint8Array | null>
  ctx: Contexte
  /** Le fond sur lequel l'IA trace (la vue de dessus du laser) : les tracés s'y superposent. */
  ortho: Ortho
  /** Des tracés déjà là (ceux de l'artisan) : ils sont gardés, l'IA les complète. */
  depart?: Trace[]
  maxTours?: number
  /** Appelé après chaque tour : de quoi garder l'état en base. */
  apresTour?: (etat: { tour: number; traces: Trace[] }) => Promise<void>
}

export type Bloc =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: (Bloc & { type: 'text' | 'image' })[] | string; is_error?: boolean }

export interface Message {
  role: 'user' | 'assistant'
  content: string | Bloc[]
}

export interface Reponse {
  content: Bloc[]
  stop_reason: string | null
  model?: string
  usage?: { input_tokens: number; output_tokens: number }
}

export interface ResultatMetreur {
  traces: Trace[]
  mesures: MesureTrace[]
  alertes: string[]
  resume: string | null
  doutes: string[]
  terminee: boolean
  tours: number
  modele: string | null
  usage: { entree: number; sortie: number }
}

const base64 = (octets: Uint8Array) => {
  let b = ''
  for (let i = 0; i < octets.length; i += 0x8000) b += String.fromCharCode(...octets.subarray(i, i + 0x8000))
  return btoa(b)
}
const image = (png: Uint8Array): Bloc => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64(png) } })

/** Ce que l'IA lit d'un tour de `tracer` : chaque objet, ce que le laser en dit, et les alertes du contrôle d'ensemble. */
export function compteRendu(mesures: MesureTrace[], alertesEnsemble: string[]): string {
  const l = mesures.map((m) => {
    const chiffres = Object.entries(m.mesure)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')} : ${v}`)
      .join(' ; ')
    return `- ${m.genre} ${m.id} → ${chiffres || '(rien de mesuré)'}${m.alertes.length ? `\n  ALERTES : ${m.alertes.join(' | ')}` : ''}`
  })
  return [...l, ...(alertesEnsemble.length ? ['', 'CONTRÔLE D’ENSEMBLE :', ...alertesEnsemble.map((a) => `- ${a}`)] : [])].join('\n')
}

const COULEURS: [number, number, number][] = [
  [220, 38, 38], [37, 99, 235], [22, 163, 74], [234, 88, 12], [147, 51, 234], [219, 39, 119], [13, 148, 136], [202, 138, 4],
]

/** Les tracés valides d'une entrée d'outil (le modèle peut se tromper : on ne lui fait pas confiance). */
function objetsValides(entree: unknown): { traces: Trace[]; refus: string[] } {
  const traces: Trace[] = [], refus: string[] = []
  const objets = (entree as { objets?: unknown[] })?.objets
  if (!Array.isArray(objets)) return { traces, refus: ['« objets » attendu : une liste'] }
  for (const o of objets as Record<string, unknown>[]) {
    const genre = o.genre as Trace['genre']
    const id = o.id
    const points = o.points
    if (!Number.isInteger(id) || (id as number) < 1) {
      refus.push(`objet sans numéro entier valide : ${JSON.stringify(o).slice(0, 80)}`)
      continue
    }
    if (!GENRES_TRACE.includes(genre)) {
      refus.push(`${id} : genre « ${String(genre)} » inconnu`)
      continue
    }
    if (!Array.isArray(points) || !points.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v)))) {
      refus.push(`${id} : points mal formés`)
      continue
    }
    const pts = (points as number[][]).map(([u, v]) => [Math.min(1000, Math.max(0, Math.round(u))), Math.min(1000, Math.max(0, Math.round(v)))] as UV)
    if (pts.length < (EST_LIGNE[genre] ? 2 : 3)) {
      refus.push(`${id} : ${EST_LIGNE[genre] ? 'une ligne' : 'un polygone'} demande ${EST_LIGNE[genre] ? 2 : 3} points au moins`)
      continue
    }
    traces.push({ id: id as number, genre, points: pts, note: typeof o.note === 'string' ? o.note.slice(0, 300) : '' })
  }
  return { traces, refus }
}

/** Les morceaux de toit que les pans tracés laissent à découvert, dits à l'IA avec leur place sur la photo. */
function alertesCouverture(traces: Trace[], ctx: Contexte): string[] {
  if (!traces.some((t) => t.genre === 'pan')) return []
  const { part, morceaux } = toitNonCouvert(traces, ctx)
  if (part < 0.06 || !morceaux.length) return []
  return [
    `Les pans que tu as tracés laissent ${Math.round(part * 100)} % du toit vu par le laser à découvert. Morceaux non couverts (position sur la grille, surface au sol) : ${morceaux.map((m) => `vers x ${m.u}, y ${m.v} (≈ ${m.aire} m²)`).join(' ; ')}. Trace les pans qui manquent, ou agrandis ceux qui sont trop petits.`,
  ]
}

/**
 * Les anciennes superpositions ne servent plus une fois remplacées : leur image
 * (≈ 1 500 jetons chacune) est retirée de l'historique, seule la dernière reste.
 */
function elaguer(messages: Message[]) {
  const positions: { m: number; b: number }[] = []
  messages.forEach((msg, m) => {
    if (!Array.isArray(msg.content)) return
    msg.content.forEach((b, i) => {
      if (b.type === 'tool_result' && Array.isArray(b.content) && b.content.some((c) => c.type === 'image') && b.content.some((c) => c.type === 'text' && /^\d+ :/.test(c.text))) positions.push({ m, b: i })
    })
  })
  for (const { m, b } of positions.slice(0, -1)) {
    const bloc = (messages[m].content as Bloc[])[b] as Extract<Bloc, { type: 'tool_result' }>
    bloc.content = (bloc.content as (Bloc & { type: 'text' | 'image' })[]).filter((c) => c.type !== 'image').concat([{ type: 'text', text: '(ancienne superposition retirée)' }])
  }
}

/** La boucle du métreur. Ne lève que si le modèle lui-même échoue. */
export async function metreur(deps: Deps): Promise<ResultatMetreur> {
  const { ctx, ortho } = deps
  const maxTours = deps.maxTours ?? 10
  let traces: Trace[] = (deps.depart ?? []).map((t) => ({ ...t }))
  const mesures = new Map<number, MesureTrace>()
  const usage = { entree: 0, sortie: 0 }
  let modele: string | null = null
  let resume: string | null = null
  let doutes: string[] = []
  let terminee = false

  const recalculer = (ids?: number[]) => {
    traces = accrocher(traces, ctx.cadre)
    const cible = traces.filter((t) => !ids || ids.includes(t.id))
    // L'emprise et les pans d'abord : les murs se mesurent avec les terrasses déjà lues.
    const ordre = [...cible].sort((a, b) => (a.genre === 'emprise' ? 1 : 0) - (b.genre === 'emprise' ? 1 : 0))
    const faites: { trace: Trace; mesure: MesureTrace }[] = traces.filter((t) => mesures.has(t.id) && !cible.includes(t)).map((t) => ({ trace: t, mesure: mesures.get(t.id)! }))
    for (const t of ordre) {
      const m = mesurerTrace(t, ctx, faites)
      mesures.set(t.id, m)
      faites.push({ trace: t, mesure: m })
    }
    return cible.map((t) => mesures.get(t.id)!)
  }

  const largeurM = ctx.cadre.bbox[2] - ctx.cadre.bbox[0], hauteurM = ctx.cadre.bbox[3] - ctx.cadre.bbox[1]
  const premiere = await deps.image('dessus')
  if (!premiere) throw new Error('vue_dessus_absente')
  // Les tracés de départ, mesurés : l'IA lit d'emblée ce que le laser en dit.
  let enDepart = ''
  if (traces.length) {
    const m = recalculer()
    enDepart = `\n\nTRACÉS PROPOSÉS PAR LE PROGRAMME, avec ce que le laser en mesure :\n${compteRendu(m, [...verifierTraces(traces, ctx.cadre), ...alertesCouverture(traces, ctx)])}`
  }
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        image(premiere),
        {
          type: 'text',
          text:
            `Voici le relief laser de la maison à mesurer, vu de dessus (${ortho.resolutionCm} cm par pixel). Il couvre ${largeurM.toFixed(0)} m d'est en ouest et ${hauteurM.toFixed(0)} m du nord au sud : 100 unités de la grille valent environ ${(largeurM / 10).toFixed(1)} m en x et ${(hauteurM / 10).toFixed(1)} m en y. ` +
            (traces.length ? `Des tracés existent déjà (${traces.some((t) => t.note.startsWith('proposé')) ? 'proposés par le programme' : 'faits par l’artisan'}) : ${traces.map((t) => `${t.genre} ${t.id}`).join(', ')}. ` : '') +
            'La maison à mesurer est au centre. Commence.' + enDepart,
        },
      ],
    },
  ]

  let tours = 0
  for (; tours < maxTours && !terminee; tours++) {
    elaguer(messages)
    const rep = await deps.creer({ system: SYSTEME, tools: OUTILS, messages })
    modele = rep.model ?? modele
    usage.entree += rep.usage?.input_tokens ?? 0
    usage.sortie += rep.usage?.output_tokens ?? 0
    messages.push({ role: 'assistant', content: rep.content })
    const appels = rep.content.filter((b): b is Extract<Bloc, { type: 'tool_use' }> => b.type === 'tool_use')
    if (!appels.length) break
    const resultats: Bloc[] = []
    for (const a of appels) {
      let contenu: (Bloc & { type: 'text' | 'image' })[] = []
      let erreur = false
      if (a.name === 'voir') {
        const vue = String((a.input as { vue?: string }).vue) as VueDemandee
        const png = await deps.image(vue)
        contenu = png ? [image(png) as Bloc & { type: 'image' }, { type: 'text', text: `Vue « ${vue} ».` }] : [{ type: 'text', text: `La vue « ${vue} » n'existe pas.` }]
        erreur = !png
      } else if (a.name === 'tracer') {
        const { traces: nouvelles, refus } = objetsValides(a.input)
        const ids = new Set(nouvelles.map((t) => t.id))
        traces = [...traces.filter((t) => !ids.has(t.id)), ...nouvelles]
        const m = recalculer([...ids])
        const ensemble = [...verifierTraces(traces, ctx.cadre), ...alertesCouverture(traces, ctx)]
        contenu = [{ type: 'text', text: [compteRendu(m, ensemble), ...(refus.length ? ['', 'REFUSÉS :', ...refus.map((r) => `- ${r}`)] : [])].join('\n') }]
        erreur = !nouvelles.length
      } else if (a.name === 'supprimer') {
        const ids = new Set(Array.isArray((a.input as { ids?: unknown[] }).ids) ? ((a.input as { ids: unknown[] }).ids.filter((v) => Number.isInteger(v)) as number[]) : [])
        traces = traces.filter((t) => !ids.has(t.id))
        for (const id of ids) mesures.delete(id)
        contenu = [{ type: 'text', text: `Supprimé : ${[...ids].join(', ') || 'rien'}. Reste : ${traces.map((t) => `${t.genre} ${t.id}`).join(', ') || 'aucun tracé'}.` }]
      } else if (a.name === 'superposer') {
        const png = await vueAvecTraces(
          ortho,
          traces.map((t, i) => ({ id: t.id, points: t.points, ferme: !EST_LIGNE[t.genre], couleur: COULEURS[i % COULEURS.length] })),
        )
        contenu = [image(png) as Bloc & { type: 'image' }, { type: 'text', text: traces.map((t, i) => `${t.id} : ${t.genre} (${['rouge', 'bleu', 'vert', 'orange', 'violet', 'rose', 'turquoise', 'jaune'][i % 8]})`).join(' ; ') || 'aucun tracé' }]
      } else if (a.name === 'terminer') {
        const e = a.input as { resume?: unknown; doutes?: unknown }
        resume = typeof e.resume === 'string' ? e.resume : null
        doutes = Array.isArray(e.doutes) ? e.doutes.filter((d): d is string => typeof d === 'string') : []
        terminee = true
        contenu = [{ type: 'text', text: 'Reçu.' }]
      } else {
        contenu = [{ type: 'text', text: `Outil « ${a.name} » inconnu.` }]
        erreur = true
      }
      resultats.push({ type: 'tool_result', tool_use_id: a.id, content: contenu, ...(erreur ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: resultats })
    await deps.apresTour?.({ tour: tours + 1, traces })
  }

  const finales = recalculer()
  return {
    traces,
    mesures: finales,
    alertes: [...verifierTraces(traces, ctx.cadre), ...alertesCouverture(traces, ctx)],
    resume,
    doutes,
    terminee,
    tours,
    modele,
    usage,
  }
}
