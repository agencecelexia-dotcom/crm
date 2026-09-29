import { formatM2, longueur, type Facade } from './geometrie'
import { pansParDefaut, type FacadeReleve, type Releve, type TypeLigne } from './releve'

/** Les pans écartés d'office : les terrasses, quand le toit a aussi des pans en pente. */
export function ecartesParDefaut(r: Releve | null): Set<number> {
  if (!r || !pansParDefaut(r)) return new Set()
  return new Set(r.pans.filter((p) => p.terrasse).map((p) => p.id))
}

/** Les lignes du toit : leur nom et leur couleur, sur la carte et dans la liste. */
export const LIGNES: Record<TypeLigne, { libelle: string; pluriel: string; couleur: string }> = {
  faitage: { libelle: 'Faîtage', pluriel: 'Faîtages', couleur: '#DC2626' },
  aretier: { libelle: 'Arêtier', pluriel: 'Arêtiers', couleur: '#EA580C' },
  noue: { libelle: 'Noue', pluriel: 'Noues', couleur: '#2563EB' },
  egout: { libelle: 'Égout (gouttière)', pluriel: 'Égouts (gouttières)', couleur: '#16A34A' },
  rive: { libelle: 'Rive', pluriel: 'Rives', couleur: '#9333EA' },
}

/** Une couleur par pan : la même sur la carte et dans la liste. */
const COULEURS_PANS = ['#E11D48', '#2563EB', '#16A34A', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5']
export const couleurPan = (id: number) => COULEURS_PANS[(id - 1) % COULEURS_PANS.length]

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/**
 * Les pans en une phrase : « 4 pans à 35 % », « 2 pans à 58 %, 1 partie
 * plate ». Des pentes à 3 points près sont la même : un toit n'est pas posé
 * au degré.
 */
export function resumePansReleve(pans: { pente: number; orientation: string }[]): string {
  const plats = pans.filter((p) => p.orientation === 'plat').length
  const penches = pans.filter((p) => p.orientation !== 'plat').map((p) => p.pente).sort((a, b) => a - b)
  const groupes: number[][] = []
  for (const v of penches) {
    const g = groupes[groupes.length - 1]
    if (g && v - g[0] <= 3) g.push(v)
    else groupes.push([v])
  }
  const morceaux = groupes.map((g) => {
    const moyenne = Math.round(g.reduce((s, v) => s + v, 0) / g.length)
    return `${g.length} pan${g.length > 1 ? 's' : ''} à ${moyenne} %`
  })
  if (plats) morceaux.push(plats > 1 ? `${plats} parties plates` : 'une partie plate')
  return morceaux.join(', ')
}

/** « 34–72 cm » : le débord mesuré, en court, pour une case. */
export function debordCourt(r: Releve): string | null {
  const { min, max } = r.debord
  if (min == null || max == null) return null
  // Un toit un peu plus court que le cadastre (pignons maçonnés du Finistère)
  // n'a pas de débord : pas de centimètres négatifs à l'écran.
  if (max < 0.05) return 'aucun'
  const a = Math.max(0, Math.round(min * 100)), b = Math.max(0, Math.round(max * 100))
  return Math.abs(b - a) < 10 ? `${Math.round((a + b) / 2)} cm` : `${a}–${b} cm`
}

/** « septembre 2021 » : le vol LiDAR, pour dire de quand date ce qu'on a vu. */
export function moisDuVol(vol: string | null): string | null {
  const m = vol?.match(/^(\d{4})-(\d{2})/)
  return m ? `${MOIS[Number(m[2]) - 1]} ${m[1]}` : null
}

const cm = (m: number) => `${Math.round(m * 100)} cm`

/** Le débord mesuré, en clair : « 34 à 72 cm selon les côtés », « 5 cm ». */
export function debordLisible(r: Releve): string | null {
  const { min, max } = r.debord
  if (min == null || max == null) return null
  if (max < 0.05) return 'aucun'
  return Math.abs(max - min) < 0.1
    ? cm(Math.max(0, (min + max) / 2))
    : `${Math.max(0, Math.round(min * 100))} à ${cm(max)} selon les côtés`
}

/**
 * L'incertitude de la surface du toit. Le bord du toit est lu à ±5 cm (toits
 * synthétiques : écart maximal de 8 cm, médian de 2) ; la pente d'un pan à
 * 0,2 point près, négligeable. Le bord domine : ±5 cm sur tout le tour.
 */
export function incertitudeToit(r: Releve): number {
  const facteur = r.surfaces.toitPlan > 0 ? r.surfaces.toitVrai / r.surfaces.toitPlan : 1
  return longueur(r.toit, true) * 0.05 * facteur
}

/** D'où vient la surface du toit : chaque ligne, un fait vérifiable. */
export function provenanceToit(r: Releve): string[] {
  const lignes = ['Nuage de points LiDAR HD de l’IGN, classé (sol, végétation, bâtiment), licence ouverte.']
  const vol = moisDuVol(r.vol)
  if (vol) lignes.push(`Vol de ${vol} : la maison a pu changer depuis.`)
  lignes.push(
    `${r.points.toit.toLocaleString('fr-FR')} points sur le toit (${Math.round(r.points.densite)} par m²), ${r.pans.length} pan${r.pans.length > 1 ? 's' : ''} lu${r.pans.length > 1 ? 's' : ''} chacun à sa pente.`,
  )
  const d = Math.hypot(r.recalage.dx, r.recalage.dy)
  lignes.push(
    d >= 0.2
      ? `Contour du cadastre recalé de ${cm(d)} sur le toit (il est placé à ±3 à 5 m).`
      : 'Contour du cadastre confirmé par le toit relevé.',
  )
  const lus = r.bords.filter((b) => b.etat === 'mesure' || b.etat === 'marche').length
  const accoles = r.bords.filter((b) => b.etat === 'accole').length
  const debord = debordLisible(r)
  if (debord) {
    lignes.push(
      `Débord mesuré sur ${lus} côté${lus > 1 ? 's' : ''} sur ${r.bords.length - accoles} : ${debord}.` +
        (accoles ? ` ${accoles} mur${accoles > 1 ? 's' : ''} mitoyen${accoles > 1 ? 's' : ''}, sans débord.` : ''),
    )
  }
  if (r.surfaces.sansPoints > 1) {
    lignes.push(`${formatM2(r.surfaces.sansPoints)} sans point (arbre ou panneaux solaires) : la pente du pan y est prolongée.`)
  }
  lignes.push(`Précision : ±5 cm sur le bord du toit, soit ±${formatM2(incertitudeToit(r))}.`)
  return lignes
}

/** D'où vient la surface d'une façade. */
export function provenanceFacade(r: Releve, murs: FacadeReleve[]): string[] {
  const lignes = [
    'Hauteur lue tous les 50 cm le long du mur : le toit relevé au LiDAR, moins 25 cm de couverture, au-dessus du sol pris à un mètre dehors.',
  ]
  const vol = moisDuVol(r.vol)
  if (vol) lignes.push(`Vol de ${vol}.`)
  if (murs.some((m) => m.type === 'pignon')) lignes.push('Le pignon est compris : la surface suit la pente du toit.')
  const mitoyen = murs.reduce((s, m) => s + m.accole, 0)
  if (mitoyen > 0.4) lignes.push(`${mitoyen.toFixed(1).replace('.', ',')} m de mur touchent un autre bâtiment : hors surface.`)
  lignes.push('Ouvertures non déduites.')
  return lignes
}

/**
 * Une façade du relevé sous la forme qu'attend la carte : ses murs recalés,
 * à surligner.
 */
export function facadeDuReleve(orientation: string, murs: FacadeReleve[]): Facade {
  return {
    orientation,
    longueur: murs.reduce((s, m) => s + m.longueur, 0),
    azimut: murs[0]?.azimut ?? 0,
    pans: murs.map((m, i) => ({
      index: i,
      longueur: m.longueur,
      azimut: m.azimut,
      orientation: m.orientation,
      a: m.a,
      b: m.b,
      aretes: m.aretes,
    })),
  }
}
