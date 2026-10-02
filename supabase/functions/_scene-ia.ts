// La SCÈNE que l'IA lit d'une maison : ce qu'elle comprend, jamais ce qu'elle
// mesure. Sans Deno ni réseau — l'appel est dans la fonction `metre-ia`.
//
// LA RÈGLE
//
// Tous les nombres du métré (hauteurs, surfaces, pentes, longueurs) viennent du
// LiDAR et de la géométrie (`_releve.ts`, `_niveaux.ts`). L'IA ne fait que :
//   - NOMMER : ce volume est la maison, ce plan est une terrasse haute, cette
//     bande entre deux niveaux est un escalier ;
//   - RATTACHER : quels pans font le toit de la maison, quel niveau porte quelle
//     terrasse — par les NUMÉROS de ce que le relevé a mesuré ;
//   - ARBITRER : le contour du cadastre est-il celui de la maison ? ;
//   - DIRE SES DOUTES.
// Le schéma ci-dessous n'a donc AUCUN champ numérique libre : des numéros de
// pans, de niveaux, de transitions — que `validerScene` vérifie un à un — et
// des énumérations. Une altitude, une surface, une hauteur n'y ont pas de place.

import type { Niveaux } from './_niveaux.ts'
import type { Releve } from './_releve.ts'

export const GENRES_VOLUME = [
  'maison',
  'annexe',
  'garage',
  'veranda',
  'abri',
  'terrasse_haute',
  'terrasse_basse',
  'balcon',
  'escalier',
  'mur_soutenement',
  'piscine',
  'jardin',
  'cour',
  'autre',
] as const
export type GenreVolume = (typeof GENRES_VOLUME)[number]

export const LIBELLES_VOLUME: Record<GenreVolume, string> = {
  maison: 'Maison',
  annexe: 'Annexe',
  garage: 'Garage',
  veranda: 'Véranda',
  abri: 'Abri',
  terrasse_haute: 'Terrasse haute',
  terrasse_basse: 'Terrasse basse',
  balcon: 'Balcon',
  escalier: 'Escalier',
  mur_soutenement: 'Mur de soutènement',
  piscine: 'Piscine',
  jardin: 'Jardin',
  cour: 'Cour',
  autre: 'Autre',
}

export type Confiance = 'haute' | 'moyenne' | 'basse'

export interface VolumeIA {
  /** « v1 », « v2 »… : l'identifiant que l'IA donne à ce volume. */
  ref: string
  genre: GenreVolume
  /** Le niveau du terrain qui le porte (numéro de `Niveaux.niveaux`), s'il en a un. */
  niveau: number | null
  /** Les pans du relevé qui en sont le toit (numéros de `Releve.pans`). */
  pans: number[]
  /** Ce que l'IA a vu, en une phrase : sur quoi elle se fonde. */
  remarque: string
  confiance: Confiance
}

export interface EscalierIA {
  /** La transition mesurée entre deux niveaux (index de `Niveaux.transitions`) que l'IA nomme escalier. */
  transition: number
  remarque: string
}

export interface SceneIA {
  /** Le contour posé sur la photo est-il bien celui de LA maison ? */
  emprise: 'oui' | 'partielle' | 'non'
  /** La maison à chiffrer est-elle mitoyenne d'un autre bâtiment (le tracé s'arrête-t-il à un mur commun) ? */
  mitoyenne: boolean
  volumes: VolumeIA[]
  escaliers: EscalierIA[]
  /** Ce que l'IA n'a pas pu trancher, ou qui contredit les mesures. */
  doutes: string[]
  confiance: Confiance
}

const enumConf = { type: 'string', enum: ['haute', 'moyenne', 'basse'] }
const entier = { type: 'integer' }

/** La forme imposée de la réponse (sorties structurées). Aucun nombre libre : des numéros et des énumérations. */
export const SCHEMA_SCENE = {
  type: 'object',
  properties: {
    emprise: { type: 'string', enum: ['oui', 'partielle', 'non'] },
    mitoyenne: { type: 'boolean' },
    volumes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          genre: { type: 'string', enum: [...GENRES_VOLUME] },
          niveau: { anyOf: [entier, { type: 'null' }] },
          pans: { type: 'array', items: entier },
          remarque: { type: 'string' },
          confiance: enumConf,
        },
        required: ['ref', 'genre', 'niveau', 'pans', 'remarque', 'confiance'],
        additionalProperties: false,
      },
    },
    escaliers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { transition: entier, remarque: { type: 'string' } },
        required: ['transition', 'remarque'],
        additionalProperties: false,
      },
    },
    doutes: { type: 'array', items: { type: 'string' } },
    confiance: enumConf,
  },
  required: ['emprise', 'mitoyenne', 'volumes', 'escaliers', 'doutes', 'confiance'],
  additionalProperties: false,
}

const m = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')} m`

/** Les couleurs des niveaux sur la carte des hauteurs, dans l'ordre : la légende que l'IA lit. */
export const COULEURS_NIVEAUX: { nom: string; rgb: [number, number, number] }[] = [
  { nom: 'bleu', rgb: [37, 99, 235] },
  { nom: 'vert', rgb: [22, 163, 74] },
  { nom: 'orange', rgb: [234, 88, 12] },
  { nom: 'violet', rgb: [147, 51, 234] },
  { nom: 'rose', rgb: [219, 39, 119] },
  { nom: 'turquoise', rgb: [13, 148, 136] },
  { nom: 'jaune', rgb: [202, 138, 4] },
  { nom: 'brun', rgb: [120, 53, 15] },
]
export const couleurNiveau = (id: number) => COULEURS_NIVEAUX[id % COULEURS_NIVEAUX.length]

/** La consigne : deux images alignées, et tout ce que le relevé a mesuré, en clair. */
export function consigneScene(r: Releve, n: Niveaux, adresse: string | null, resolutionCm: number): string {
  const pans = r.pans
    .map(
      (p) =>
        `  - pan ${p.id} : ${p.terrasse ? 'DALLE PLATE plus basse que les égouts (terrasse ?)' : p.orientation === 'plat' ? 'partie plate' : `versant ${p.orientation}, pente ${Math.round(p.pente)} %`}, ${Math.round(p.aireVraie)} m²`,
    )
    .join('\n')
  const niveaux = n.niveaux
    .map(
      (v) =>
        `  - niveau ${v.id} (${couleurNiveau(v.id).nom}) : ${v.origine === 'dalle' ? 'dalle relevée sur le toit' : 'sol lu par le laser'}, à ${m(v.z)} du repère de la maison, ${Math.round(v.aire)} m² plats${v.distanceMaison < 0.5 ? ', contre la maison' : `, à ${m(v.distanceMaison)} de la maison`}`,
    )
    .join('\n')
  const transitions = n.transitions
    .map((t, i) => {
      const genre = t.genre === 'a_voir' ? 'nature inconnue (marches ou à pic : à lire sur la photo)' : t.genre
      return `  - transition ${i} : entre le niveau ${t.entre[0]} et le niveau ${t.entre[1]}, ${m(t.denivele)} de dénivelé sur ${m(t.longueur)} de long, ${genre}`
    })
    .join('\n')
  const facades = r.facades
    .filter((f) => !f.retrait)
    .map((f) => `  - mur ${f.index} (${f.orientation}) : ${m(f.longueur)} de long, ${m(f.hauteurBasse)} à ${m(f.hauteurHaute)} de haut${f.accole > 0 ? `, dont ${m(f.accole)} accolé à un autre bâtiment` : ''}`)
    .join('\n')
  return [
    `Tu lis la scène d'une maison${adresse ? ` (${adresse})` : ''} pour un métré. Deux images alignées, nord en haut, même cadrage : 1) la photo aérienne verticale de l'IGN à ${resolutionCm} cm par pixel ; 2) la carte des hauteurs relevées au laser LiDAR, où chaque niveau du terrain est teinté (légende ci-dessous) et le contour de la maison est tracé en noir. Les toits y sont en dégradé de gris : plus clair = plus haut.`,
    '',
    'Ce que le relevé LiDAR a MESURÉ (tu ne le corriges pas, tu le rattaches) :',
    `Pans de toit (${r.pans.length}) :`,
    pans,
    `Niveaux du terrain (${n.niveaux.length}) :`,
    niveaux || '  (aucun niveau plat lu)',
    `Transitions entre niveaux (${n.transitions.length}) :`,
    transitions || '  (aucune)',
    'Murs du contour :',
    facades,
    '',
    'Ce qu\'on te demande :',
    '- emprise : « oui » si le contour noir est bien celui de la maison, « partielle » s\'il en oublie ou en ajoute un morceau (annexe, extension, voisin), « non » s\'il désigne autre chose.',
    '- mitoyenne : vrai si la maison touche un autre bâtiment par un mur commun.',
    '- volumes : chaque ensemble distinct que tu vois — la maison, ses annexes et garages, les terrasses (haute = au niveau de la maison ; basse = en contrebas), balcons, escaliers, murs de soutènement, piscine, jardin, cour. Pour chacun : le genre ; son niveau (le numéro du niveau du terrain qui le porte, ou null) ; les numéros des pans de toit qui le couvrent (une terrasse sans toit n\'en a pas) ; une phrase sur ce que tu as vu ; ta confiance.',
    '- escaliers : parmi les transitions ci-dessus, celles qui sont un escalier (marches visibles sur la photo), par leur numéro.',
    '- doutes : tout ce que tu n\'as pas pu trancher, ou qui contredit les mesures (une « terrasse » que la photo montre couverte, un pan que tu ne sais pas rattacher…).',
    '',
    'Règles :',
    '- Aucun nombre à toi : ni altitude, ni surface, ni hauteur. Des numéros de pans, de niveaux et de transitions, tels qu\'ils sont listés — jamais un numéro qui n\'y est pas.',
    '- Chaque pan de toit appartient au plus à un volume.',
    '- Si la photo et les mesures se contredisent, dis-le dans les doutes ; ne choisis pas la photo contre les mesures.',
    '- N\'invente rien : un volume que tu ne vois pas n\'existe pas.',
  ].join('\n')
}

export interface VerifScene {
  /** Ce que la validation a retiré ou corrigé, en clair. */
  corrections: string[]
  /** Ce que l'artisan doit vérifier : les doutes de l'IA et ce que les mesures contredisent. */
  a_verifier: string[]
  /** Quels pans ont été retenus (ceux de l'IA ou ceux de l'algorithme), et pourquoi. */
  releve_ia?: string
}

/**
 * Confronte la scène de l'IA aux mesures : un numéro qui n'existe pas tombe, un
 * pan revendiqué par deux volumes reste au premier, une « terrasse haute » qui
 * n'est ni une dalle ni au-dessus du sol voisin devient un doute. La mesure
 * gagne toujours ; la scène rendue n'a que des références valides.
 */
export function validerScene(s: SceneIA, r: Releve, n: Niveaux): { scene: SceneIA; verif: VerifScene } {
  const corrections: string[] = []
  const a_verifier: string[] = [...s.doutes]
  const pansExistants = new Set(r.pans.map((p) => p.id))
  const niveauxExistants = new Set(n.niveaux.map((v) => v.id))
  const pris = new Set<number>()
  const refs = new Set<string>()

  const volumes = s.volumes.map((v, i): VolumeIA => {
    let ref = v.ref || `v${i + 1}`
    if (refs.has(ref)) ref = `${ref}-${i + 1}`
    refs.add(ref)
    const pans = v.pans.filter((p) => {
      if (!pansExistants.has(p)) {
        corrections.push(`${ref} : le pan ${p} n'existe pas, retiré.`)
        return false
      }
      if (pris.has(p)) {
        corrections.push(`${ref} : le pan ${p} est déjà pris par un autre volume, laissé au premier.`)
        return false
      }
      pris.add(p)
      return true
    })
    let niveau = v.niveau
    if (niveau != null && !niveauxExistants.has(niveau)) {
      corrections.push(`${ref} : le niveau ${niveau} n'existe pas, retiré.`)
      niveau = null
    }
    const sortie = { ...v, ref, pans, niveau }
    // Une terrasse est PLATE : un volume « terrasse » couvert de pans en pente contredit la mesure.
    if (v.genre === 'terrasse_haute' || v.genre === 'terrasse_basse') {
      const pentus = pans.filter((p) => r.pans.find((q) => q.id === p)?.orientation !== 'plat')
      if (pentus.length) {
        a_verifier.push(`${ref} (${LIBELLES_VOLUME[v.genre].toLowerCase()}) est couverte de pans en pente (${pentus.join(', ')}) : à vérifier.`)
      }
    }
    if (v.genre === 'maison' && pans.length && pans.every((p) => r.pans.find((q) => q.id === p)?.terrasse)) {
      a_verifier.push(`${ref} est nommée maison, mais tous ses pans sont des dalles plates plus basses que les égouts : à vérifier.`)
    }
    return sortie
  })

  const escaliers = s.escaliers.filter((e) => {
    const ok = Number.isInteger(e.transition) && e.transition >= 0 && e.transition < n.transitions.length
    if (!ok) corrections.push(`Escalier : la transition ${e.transition} n'existe pas, retiré.`)
    return ok
  })
  // Les pans que nul volume ne couvre : à dire.
  const libres = r.pans.filter((p) => !pris.has(p.id) && !p.terrasse).map((p) => p.id)
  if (libres.length) a_verifier.push(`Pans de toit que l'IA n'a rattachés à aucun volume : ${libres.join(', ')}.`)
  if (!volumes.some((v) => v.genre === 'maison')) a_verifier.push("L'IA n'a désigné aucun volume comme la maison.")
  if (s.emprise !== 'oui') a_verifier.push(`Le contour de la maison est jugé « ${s.emprise === 'non' ? 'faux' : 'partiel'} » sur la photo.`)

  return { scene: { ...s, volumes, escaliers }, verif: { corrections, a_verifier: [...new Set(a_verifier)] } }
}
