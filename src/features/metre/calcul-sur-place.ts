import { photoDeLaFacade, resultatRetenu, SURFACES_TYPES, type PhotoLue } from './ouvertures'
import { facadeRetenue, orientationsDesFacades, type Releve } from './releve'

/**
 * SUR PLACE, FAÇADE PAR FAÇADE
 *
 * Devant la maison, l'artisan photographie chaque façade (la vision y compte
 * les ouvertures, il retire celles en trop), ajoute celles que la photo n'a pas
 * vues, et peut relever une cote au mètre : la longueur du mur, la hauteur à
 * la gouttière. Le calcul suit ; une fois toutes les façades vues, les
 * chiffres vont au dossier comme « mesurés sur place ».
 */
export interface SaisieFacade {
  /** Longueur mesurée (m), si l'artisan l'a relevée. */
  longueur?: number | null
  /** Hauteur à la gouttière mesurée (m). */
  hauteur?: number | null
  /** Ouvertures ajoutées à la main (comptées comme une fenêtre type). */
  ajoutees?: number
  /** L'artisan a vu cette façade. */
  vue?: boolean
}

export interface FacadeSurPlace {
  orientation: string
  /** Relevé LiDAR. */
  longueur: number
  hauteur: number
  brute: number
  /** Après les cotes mesurées. */
  bruteCorrigee: number
  ouvertures: { nombre: number; surface: number; photo: boolean }
  nette: number
  vue: boolean
  corrigee: boolean
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

export function facadesSurPlace(r: Releve, photos: PhotoLue[], saisies: Record<string, SaisieFacade>): FacadeSurPlace[] {
  return orientationsDesFacades(r)
    .map((o) => ({ o, f: facadeRetenue(r, o) }))
    .filter(({ f }) => f.surface > 0)
    .map(({ o, f }) => {
      const s = saisies[o] ?? {}
      // La hauteur à la gouttière du relevé : le bas du mur principal (celle d'un pignon est à ses angles).
      const principal = [...f.murs].sort((a, b) => b.surfaceLibre - a.surfaceLibre)[0]
      const hauteur = principal?.hauteurBasse ?? f.hauteur ?? 0
      // La longueur change toute la surface ; la hauteur, seulement la bande
      // sous la gouttière (la pointe d'un pignon ne bouge pas).
      const kL = s.longueur && f.longueur > 0 ? s.longueur / f.longueur : 1
      const dH = s.hauteur && hauteur > 0 ? s.hauteur - hauteur : 0
      const bruteCorrigee = r2(Math.max(0, f.surface * kL + f.longueur * kL * dH))
      const photo = photoDeLaFacade(photos, o)
      const res = photo ? resultatRetenu(photo) : null
      const lues = res?.utilisable && res.surface != null ? { nombre: res.nombre, surface: res.surface } : { nombre: 0, surface: 0 }
      const ajoutees = s.ajoutees ?? 0
      const ouvertures = {
        nombre: lues.nombre + ajoutees,
        surface: r1(lues.surface + ajoutees * SURFACES_TYPES.fenetre.type),
        photo: lues.nombre > 0 || !!res?.utilisable,
      }
      return {
        orientation: o,
        longueur: f.longueur,
        hauteur,
        brute: f.surface,
        bruteCorrigee,
        ouvertures,
        nette: r2(Math.max(0, bruteCorrigee - ouvertures.surface)),
        vue: !!s.vue,
        corrigee: kL !== 1 || dH !== 0,
      }
    })
}

/**
 * Ce qui part au dossier, une fois TOUTES les façades vues : une façade
 * oubliée et la nette serait fausse sans le dire.
 */
export function correctionsSurPlace(
  facades: FacadeSurPlace[],
  saisies: Record<string, SaisieFacade>,
): { cle: string; unite: 'm2' | 'm' | 'u'; valeur: number }[] {
  if (!facades.length || !facades.every((f) => f.vue)) return []
  const sortie: { cle: string; unite: 'm2' | 'm' | 'u'; valeur: number }[] = [
    { cle: 'facades_total', unite: 'm2', valeur: r2(facades.reduce((s, f) => s + f.bruteCorrigee, 0)) },
    { cle: 'ouvertures', unite: 'u', valeur: facades.reduce((s, f) => s + f.ouvertures.nombre, 0) },
    { cle: 'ouvertures_surface', unite: 'm2', valeur: r1(facades.reduce((s, f) => s + f.ouvertures.surface, 0)) },
    { cle: 'facade_nette', unite: 'm2', valeur: r2(facades.reduce((s, f) => s + f.nette, 0)) },
  ]
  const h = hauteurSurPlace(facades, saisies)
  if (h != null) sortie.push({ cle: 'hauteur_murs', unite: 'm', valeur: h })
  return sortie
}

/** La note gardée avec chaque valeur : la date, et les cotes relevées façade par façade. */
export function noteSurPlace(facades: FacadeSurPlace[], saisies: Record<string, SaisieFacade>, date: Date): string {
  const cotes = facades
    .map((f) => {
      const s = saisies[f.orientation] ?? {}
      const c = [s.longueur ? `L ${s.longueur} m` : null, s.hauteur ? `H ${s.hauteur} m` : null].filter(Boolean).join(', ')
      return `${f.orientation} ${f.ouvertures.nombre} ouv.${c ? ` (${c})` : ''}`
    })
    .join(' ; ')
  return `Sur place le ${date.toLocaleDateString('fr-FR')} : ${cotes}`.slice(0, 500)
}

/** La hauteur à la gouttière mesurée sur place : celle de la façade la plus longue qui en a une. */
export function hauteurSurPlace(facades: FacadeSurPlace[], saisies: Record<string, SaisieFacade>): number | null {
  const mesurees = facades.filter((f) => saisies[f.orientation]?.hauteur).sort((a, b) => b.longueur - a.longueur)
  return mesurees.length ? saisies[mesurees[0].orientation].hauteur! : null
}
