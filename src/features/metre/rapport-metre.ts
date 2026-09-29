import { debordLisible, LIGNES, moisDuVol } from './affichage-releve'
import { formatM, formatM2 } from './geometrie'
import { LIBELLES_TOIT, materiauDeBdnb, type MateriauxGardes } from './materiaux'
import { photoDeLaFacade, resultatRetenu, type PhotoLue } from './ouvertures'
import {
  facadeRetenue,
  lignesRetenues,
  orientationsDesFacades,
  pansParDefaut,
  toitRetenu,
  TYPES_LIGNES,
  type Releve,
  type TypeLigne,
} from './releve'

/**
 * Le rapport de métré d'une maison : UNE structure, lue par l'écran, le PDF et
 * le tableau. Les additions sont celles du dossier (`_releve-retenu.ts`,
 * `_mesures-chantier.ts`) : le rapport ne recalcule rien à sa façon. Chaque
 * chiffre y garde sa provenance.
 */
export interface PhotoDuRapport extends PhotoLue {
  auteur: string | null
  licence: string | null
  pris_le: string | null
}

export interface EntreeRapport {
  titre: string | null
  adresse: string | null
  date: Date
  releve: Releve
  /** Les pans retenus par l'artisan ; null : ceux du dossier (sans les terrasses). */
  pans: number[] | null
  photos: PhotoDuRapport[]
  materiaux: MateriauxGardes | null
  /** Ce que la BDNB déclare, faute de lecture. */
  bdnb?: { toit?: string | null; murs?: string | null } | null
}

export interface FacadeRapport {
  orientation: string
  rue: boolean
  longueur: number
  hauteurMin: number
  hauteurMax: number
  brute: number
  ouvertures: { nombre: number; surface: number; methode: 'mesure' | 'forfait' | null; photo: PhotoLue['source'] } | null
  /** Brute moins ouvertures ; null tant que les ouvertures ne sont pas lues. */
  nette: number | null
  materiau: string | null
  retrait: boolean
}

/** Une ligne du tableau : ce que le CSV exporte, dans l'ordre. */
export interface LigneRapport {
  rubrique: string
  element: string
  quantite: number | null
  unite: 'm²' | 'ml' | 'm' | '%' | 'u' | ''
  /** Ce que la quantité ne dit pas (« 3 fenêtres, 1 porte »), ou le texte d'une ligne sans nombre. */
  detail: string
  source: string
}

export interface RapportMetre {
  titre: string | null
  adresse: string | null
  date: Date
  toiture: {
    pans: { id: number; nom: string; pente: number; surface: number; retenu: boolean; terrasse: boolean }[]
    surface: number
    plan: number
    pente: number
    nombre: number
    debord: string | null
  }
  lineaires: { type: TypeLigne; libelle: string; longueur: number; nombre: number }[]
  facades: FacadeRapport[]
  totalFacades: { brute: number; ouvertures: number; nette: number | null }
  hauteurs: { gouttiere: number | null; faitage: number | null }
  materiaux: { toit: { libelle: string; provenance: string } | null; murs: { libelle: string; provenance: string } | null }
  lignes: LigneRapport[]
  sources: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
const LICENCE = (l: string | null) => (l === 'CC-BY-SA-4.0' ? 'CC BY-SA 4.0' : (l ?? ''))

export function rapportMetre(e: EntreeRapport): RapportMetre {
  const r = e.releve
  const vol = moisDuVol(r.vol)
  const LIDAR = `LiDAR HD IGN${vol ? `, ${vol}` : ''}`
  const retenus = e.pans ?? pansParDefaut(r)
  const toit = toitRetenu(r, retenus)
  const pans = r.pans.map((p) => ({
    id: p.id,
    nom: p.terrasse ? 'Terrasse' : p.orientation === 'plat' ? 'Partie plate' : `Pan ${p.orientation}`,
    pente: Math.round(p.pente),
    surface: p.aireVraie,
    retenu: !retenus || retenus.includes(p.id),
    terrasse: p.terrasse,
  }))

  const { totaux } = lignesRetenues(r, retenus)
  const lineaires = TYPES_LIGNES.filter((t) => totaux[t].nombre > 0).map((t) => ({
    type: t,
    libelle: LIGNES[t].pluriel,
    longueur: Math.round(totaux[t].longueur * 10) / 10,
    nombre: totaux[t].nombre,
  }))

  // LES FAÇADES : brute (LiDAR), ouvertures (photo, moins celles retirées), nette.
  const facades: FacadeRapport[] = orientationsDesFacades(r).map((o) => {
    const f = facadeRetenue(r, o)
    const photo = photoDeLaFacade(e.photos, o)
    const res = photo ? resultatRetenu(photo) : null
    const ouvertures =
      res?.utilisable && res.surface != null
        ? { nombre: res.nombre, surface: res.surface, methode: res.methode, photo: photo!.source }
        : null
    return {
      orientation: o,
      rue: f.murs.some((m) => m.rue),
      longueur: f.longueur,
      hauteurMin: Math.min(...f.murs.map((m) => m.hauteurBasse)),
      hauteurMax: Math.max(...f.murs.map((m) => m.hauteurHaute)),
      brute: f.surface,
      ouvertures,
      nette: ouvertures ? r2(Math.max(0, f.surface - ouvertures.surface)) : null,
      materiau: photo?.lecture?.vision.materiau?.trim() || null,
      retrait: f.murs.every((m) => m.retrait),
    }
  })
  const aTraiter = facades.filter((f) => f.brute > 0)
  const totalFacades = {
    brute: r2(aTraiter.reduce((s, f) => s + f.brute, 0)),
    ouvertures: Math.round(aTraiter.reduce((s, f) => s + (f.ouvertures?.surface ?? 0), 0) * 10) / 10,
    // Comme au dossier : la nette totale seulement si chaque façade a ses ouvertures.
    nette: aTraiter.length && aTraiter.every((f) => f.nette != null) ? r2(aTraiter.reduce((s, f) => s + f.nette!, 0)) : null,
  }

  // LES MATÉRIAUX : lus d'abord, déclarés à défaut — et dits pour ce qu'ils sont.
  const lu = e.materiaux?.toit?.meme_batiment && e.materiaux.toit.materiau !== 'indetermine' ? e.materiaux.toit : null
  const declare = materiauDeBdnb(e.bdnb?.toit)
  const materiauToit = lu
    ? { libelle: `${LIBELLES_TOIT[lu.materiau]} (${lu.couleur})`, provenance: `photo aérienne IGN ${e.materiaux!.resolution_cm} cm, lue par IA` }
    : declare
      ? { libelle: LIBELLES_TOIT[declare], provenance: 'déclaré (BDNB)' }
      : null
  const murLu = facades.find((f) => f.materiau)
  const materiauMurs = murLu
    ? { libelle: murLu.materiau!, provenance: `photo de la façade ${murLu.orientation}, lue par IA` }
    : e.bdnb?.murs
      ? { libelle: murDeBdnb(e.bdnb.murs), provenance: 'déclaré (BDNB)' }
      : null

  // LE TABLEAU
  const lignes: LigneRapport[] = []
  for (const p of pans) {
    lignes.push({
      rubrique: 'Toiture',
      element: p.nom,
      quantite: p.surface,
      unite: 'm²',
      detail: [p.terrasse ? null : `pente ${p.pente} %`, p.retenu ? null : 'non compté'].filter(Boolean).join(', '),
      source: LIDAR,
    })
  }
  lignes.push({
    rubrique: 'Toiture',
    element: 'Total compté',
    quantite: toit.vrai,
    unite: 'm²',
    detail: `${toit.nb} pans, pente moyenne ${String(toit.pente).replace('.', ',')} %`,
    source: LIDAR,
  })
  lignes.push({ rubrique: 'Toiture', element: 'Vue du dessus', quantite: toit.plan, unite: 'm²', detail: '', source: LIDAR })
  const debord = debordLisible(r)
  if (debord) lignes.push({ rubrique: 'Toiture', element: 'Débord', quantite: null, unite: '', detail: debord, source: LIDAR })
  for (const l of lineaires) {
    lignes.push({ rubrique: 'Linéaires', element: l.libelle, quantite: l.longueur, unite: 'ml', detail: `${l.nombre} tronçon${l.nombre > 1 ? 's' : ''}`, source: LIDAR })
  }
  for (const f of facades) {
    const nom = `Façade ${f.orientation}${f.rue ? ' (rue)' : ''}${f.retrait ? ' (en retrait)' : ''}`
    const hauteur = f.hauteurMax - f.hauteurMin < 0.3 ? formatM(f.hauteurMin) : `${formatM(f.hauteurMin)} à ${formatM(f.hauteurMax)}`
    lignes.push({
      rubrique: 'Façades',
      element: `${nom}, brute`,
      quantite: f.brute,
      unite: 'm²',
      detail: f.brute > 0 ? `${formatM(f.longueur)} de long, ${hauteur} de haut` : 'mitoyenne',
      source: LIDAR,
    })
    if (f.ouvertures) {
      lignes.push({
        rubrique: 'Façades',
        element: `${nom}, ouvertures`,
        quantite: f.ouvertures.surface,
        unite: 'm²',
        detail: `${f.ouvertures.nombre} ouverture${f.ouvertures.nombre > 1 ? 's' : ''}${f.ouvertures.methode === 'forfait' ? ', surfaces types' : ''}`,
        source: f.ouvertures.photo === 'artisan' ? 'photo de l’artisan, lue par IA' : `photo ${f.ouvertures.photo}, lue par IA`,
      })
      lignes.push({ rubrique: 'Façades', element: `${nom}, nette`, quantite: f.nette, unite: 'm²', detail: 'ouvertures déduites', source: 'LiDAR − photo' })
    }
  }
  lignes.push({
    rubrique: 'Façades',
    element: 'Total brut',
    quantite: totalFacades.brute,
    unite: 'm²',
    detail: 'hors mitoyen, ouvertures non déduites',
    source: LIDAR,
  })
  if (totalFacades.nette != null) {
    lignes.push({ rubrique: 'Façades', element: 'Total net', quantite: totalFacades.nette, unite: 'm²', detail: 'ouvertures déduites', source: 'LiDAR − photos' })
  }
  if (r.hauteurs.gouttiere != null) {
    lignes.push({ rubrique: 'Hauteurs', element: 'À la gouttière', quantite: r.hauteurs.gouttiere, unite: 'm', detail: '', source: LIDAR })
  }
  if (r.hauteurs.faitage != null) {
    lignes.push({ rubrique: 'Hauteurs', element: 'Au faîtage', quantite: r.hauteurs.faitage, unite: 'm', detail: '', source: LIDAR })
  }
  if (materiauToit) lignes.push({ rubrique: 'Matériaux', element: 'Couverture', quantite: null, unite: '', detail: materiauToit.libelle, source: materiauToit.provenance })
  if (lu?.fenetres_toit != null) lignes.push({ rubrique: 'Matériaux', element: 'Fenêtres de toit', quantite: lu.fenetres_toit, unite: 'u', detail: '', source: 'photo aérienne IGN 5 cm, lue par IA' })
  if (lu?.cheminees != null) lignes.push({ rubrique: 'Matériaux', element: 'Cheminées', quantite: lu.cheminees, unite: 'u', detail: '', source: 'photo aérienne IGN 5 cm, lue par IA' })
  if (materiauMurs) lignes.push({ rubrique: 'Matériaux', element: 'Murs', quantite: null, unite: '', detail: materiauMurs.libelle, source: materiauMurs.provenance })

  // LES SOURCES, à citer (les photos de rue sont sous licence libre, avec leur auteur).
  const sources = [
    `Relevé : points LiDAR HD de l’IGN${vol ? `, vol de ${vol}` : ''} (Licence ouverte Etalab), contour de la BD TOPO recalé sur le toit.`,
  ]
  if (lu) sources.push(`Matériau du toit : orthophotographie de l’IGN à ${e.materiaux!.resolution_cm} cm, lue par IA le ${e.materiaux!.lu_le.slice(0, 10)}.`)
  for (const f of facades) {
    const p = f.ouvertures ? photoDeLaFacade(e.photos, f.orientation) : null
    if (!p) continue
    sources.push(
      p.source === 'artisan'
        ? `Façade ${f.orientation} : photo de l’artisan${p.pris_le ? ` du ${p.pris_le.slice(0, 10)}` : ''}.`
        : `Façade ${f.orientation} : photo ${p.source === 'panoramax' ? 'Panoramax' : 'Mapillary'}, ${p.auteur ?? 'auteur anonyme'}, ${LICENCE(p.licence)}${p.pris_le ? `, ${moisDuVol(p.pris_le.slice(0, 10))}` : ''}.`,
    )
  }
  sources.push('Mesures à distance, à confirmer sur place avant commande.')

  return {
    titre: e.titre,
    adresse: e.adresse,
    date: e.date,
    toiture: { pans, surface: toit.vrai, plan: toit.plan, pente: toit.pente, nombre: toit.nb, debord: debordLisible(r) },
    lineaires,
    facades,
    totalFacades,
    hauteurs: { gouttiere: r.hauteurs.gouttiere, faitage: r.hauteurs.faitage },
    materiaux: { toit: materiauToit, murs: materiauMurs },
    lignes,
    sources,
  }
}

/** Le matériau des murs que déclare la BDNB (« BETON », « BRIQUES »), écrit comme on le dit. */
function murDeBdnb(t: string): string {
  const mots: Record<string, string> = { beton: 'béton', agglomere: 'aggloméré', meuliere: 'meulière', briques: 'briques', pierre: 'pierre' }
  const bas = t.toLowerCase().trim()
  const dit = bas.replace(/[a-zéèêàç]+/g, (m) => mots[m] ?? m)
  return dit.charAt(0).toUpperCase() + dit.slice(1)
}

/** Un nombre à la française, pour le tableur : virgule décimale, sans séparateur de milliers. */
const nombreCsv = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
const champ = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** Le tableau, pour Excel : UTF-8 avec BOM (les accents), séparateur « ; » (Excel français). */
export function csvDuRapport(r: RapportMetre): string {
  const tete = ['Rubrique', 'Élément', 'Quantité', 'Unité', 'Détail', 'Source']
  const corps = r.lignes.map((l) =>
    [l.rubrique, l.element, l.quantite == null ? '' : nombreCsv(l.quantite), l.unite, l.detail, l.source].map(champ).join(';'),
  )
  const entete = [
    [champ(`Métré${r.titre ? ` — ${r.titre}` : ''}`)],
    r.adresse ? [champ(r.adresse)] : [],
    [`Établi le ${r.date.toLocaleDateString('fr-FR')}`],
    [],
  ].map((l) => l.join(';'))
  return '﻿' + [...entete, tete.join(';'), ...corps, '', ...r.sources.map(champ)].join('\r\n')
}

/** Le résumé en une phrase, pour l'écran : « Toit 254 m² · façades 412 m² brutes ». */
export function resumeDuRapport(r: RapportMetre): string {
  const parts = [`Toit ${formatM2(r.toiture.surface)}`, `façades ${formatM2(r.totalFacades.brute)} brutes`]
  if (r.totalFacades.nette != null) parts.push(`${formatM2(r.totalFacades.nette)} nettes`)
  return parts.join(' · ')
}
