import calage from './calage.json'
import { PARTIES, type IdPartie } from './script'
import { FPS } from './theme'

export type Calage = { source: 'provisoire' | 'antoine'; duree: number; video?: string; cadrage?: string; parties: { id: IdPartie; debut: number; fin: number; audio?: string }[] }
export const CALAGE = calage as Calage

export const totalImages = () => Math.round(CALAGE.duree * FPS)

/** Début et fin d'affichage d'une partie, en images (jusqu'à la suivante). */
export function bornes(id: IdPartie) {
  const i = CALAGE.parties.findIndex((p) => p.id === id)
  const p = CALAGE.parties[i]
  const debut = i === 0 ? 0 : Math.round(p.debut * FPS)
  const suivante = CALAGE.parties[i + 1]
  const fin = suivante ? Math.round(suivante.debut * FPS) : totalImages()
  return { debut, duree: fin - debut, parole: { debut: Math.round(p.debut * FPS) - debut, fin: Math.round(p.fin * FPS) - debut } }
}

const texteDe = (id: IdPartie) => PARTIES.find((p) => p.id === id)!.texte.join(' ')

/**
 * Image (relative au début de la partie) où `mot` est prononcé.
 * La parole est supposée régulière : la position du mot dans le texte donne
 * sa position dans le temps. Assez juste pour une voix posée.
 */
export function quand(id: IdPartie, mot: string | undefined, decalage = 0) {
  const { parole } = bornes(id)
  if (!mot) return parole.debut
  const texte = texteDe(id)
  const i = texte.indexOf(mot)
  if (i < 0) throw new Error(`« ${mot} » absent du texte de la partie ${id}`)
  return Math.round(parole.debut + (parole.fin - parole.debut) * (i / texte.length) + decalage * FPS)
}

function couper(phrase: string): string[] {
  if (phrase.trim().length <= 90) return [phrase]
  const coupes = [...phrase.matchAll(/[,:;] /g)].map((m) => m.index! + 2).filter((i) => i > 25 && i < phrase.length - 20)
  if (!coupes.length) return [phrase]
  const milieu = phrase.length / 2
  const i = coupes.reduce((a, b) => (Math.abs(b - milieu) < Math.abs(a - milieu) ? b : a))
  return [...couper(phrase.slice(0, i)), ...couper(phrase.slice(i))]
}

/** Phrase en cours de lecture (sous-titre), d'après la même règle. */
export function phrases(id: IdPartie) {
  const texte = texteDe(id)
  // Phrases, puis morceaux de 90 caractères au plus, coupés à une virgule
  // ou un deux-points : un sous-titre doit se lire d'un coup d'œil.
  const morceaux = (texte.match(/[^.!?…]+[.!?…]+[»"]?\s*|[^.!?…]+$/g) ?? [texte]).flatMap(couper)
  const { parole } = bornes(id)
  let pos = 0
  return morceaux.map((m) => {
    const a = pos
    pos += m.length
    return {
      texte: m.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase()),
      debut: Math.round(parole.debut + (parole.fin - parole.debut) * (a / texte.length)),
      fin: Math.round(parole.debut + (parole.fin - parole.debut) * (pos / texte.length)),
    }
  })
}
