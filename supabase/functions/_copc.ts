// Lecture d'un nuage de points COPC (LAS 1.4 compressé, organisé en octree) —
// sans Deno ni bibliothèque : l'écran, les fonctions, les tests et le banc
// lisent le même code.
//
// POURQUOI LES POINTS, ET PAS LA GRILLE
//
// La grille d'altitudes à 50 cm (MNS/MNH) mélange tout : le bord du toit, la
// haie qui le touche, le toit du voisin. Le nuage LiDAR HD de l'IGN, lui, porte
// la CLASSE de chaque point (sol, végétation, bâtiment), à environ 39 points
// par m². Le bord réel d'un toit — débord compris — s'y lit sans confondre un
// arbre avec une gouttière.
//
// COMMENT ON N'EN LIT QU'UNE MAISON
//
// Une dalle d'un kilomètre pèse 180 Mo. Le format COPC range les points dans un
// octree dont chaque nœud est compressé à part, et le serveur de l'IGN accepte
// les lectures partielles (HTTP Range, réponse 206) : on lit l'en-tête, puis la
// hiérarchie, puis les seuls nœuds qui touchent la zone — À TOUS LES NIVEAUX,
// car chaque point n'est rangé qu'à un seul niveau et la densité complète est
// la somme des niveaux.
//
// La décompression LAZ est injectée (`Decompresseur`) : `laz-perf` en
// WebAssembly côté serveur et dans les scripts, des octets rejoués en test.

/** Lire les octets [debut, fin[ du fichier. */
export type LireOctets = (debut: number, fin: number) => Promise<Uint8Array>

/** Décompresser un nœud LAZ : `nbPoints` enregistrements de `longueur` octets. */
export type Decompresseur = (
  compresse: Uint8Array,
  nbPoints: number,
  format: number,
  longueur: number,
) => Promise<Uint8Array>

/** Ce que l'on utilise du module WebAssembly de laz-perf. */
export interface ModuleLazPerf {
  HEAPU8: Uint8Array
  _malloc(octets: number): number
  _free(pointeur: number): void
  ChunkDecoder: new () => {
    open(format: number, longueur: number, pointeur: number): void
    getPoint(pointeur: number): void
    delete(): void
  }
}

/**
 * Un décompresseur laz-perf, chargé au premier nœud. Le chargement est
 * injecté : Deno embarque le WebAssembly (`_laz.ts`), Node le lit dans le
 * paquet npm (`scripts/laz-node.ts`).
 */
export function decompresseurLazPerf(charger: () => Promise<ModuleLazPerf>): Decompresseur {
  let module: Promise<ModuleLazPerf> | null = null
  return async (compresse, nbPoints, format, longueur) => {
    module ??= charger()
    const L = await module
    const sortie = new Uint8Array(nbPoints * longueur)
    const pBloc = L._malloc(compresse.byteLength)
    const pPoint = L._malloc(longueur)
    const decodeur = new L.ChunkDecoder()
    try {
      // HEAPU8 se relit à chaque fois : la mémoire du module peut grandir.
      L.HEAPU8.set(compresse, pBloc)
      decodeur.open(format, longueur, pBloc)
      for (let i = 0; i < nbPoints; i++) {
        decodeur.getPoint(pPoint)
        sortie.set(L.HEAPU8.subarray(pPoint, pPoint + longueur), i * longueur)
      }
    } finally {
      L._free(pBloc)
      L._free(pPoint)
      decodeur.delete()
    }
    return sortie
  }
}

export interface EnteteCopc {
  formatPoint: number
  longueurPoint: number
  echelle: [number, number, number]
  decalage: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  nbPoints: number
  /** Le cube racine de l'octree. */
  centre: [number, number, number]
  demiCote: number
  espacement: number
  racineHierarchie: { offset: number; longueur: number }
}

export interface Noeud {
  cle: [number, number, number, number]
  offset: number
  longueur: number
  nbPoints: number
}

/** Une zone rectangulaire, en Lambert-93. */
export interface Zone {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const u64 = (dv: DataView, o: number) => Number(dv.getBigUint64(o, true))

/** L'en-tête LAS 1.4 et la VLR « copc » d'information, en une seule lecture. */
export async function lireEntete(lire: LireOctets): Promise<EnteteCopc> {
  // La VLR COPC suit l'en-tête (375 octets) : 65 ko couvrent les deux, et les
  // autres VLR, en un seul aller-retour.
  const tete = await lire(0, 65536)
  const dv = new DataView(tete.buffer, tete.byteOffset, tete.byteLength)
  if (String.fromCharCode(tete[0], tete[1], tete[2], tete[3]) !== 'LASF') throw new Error('copc_signature')
  if (tete[24] !== 1 || tete[25] !== 4) throw new Error('copc_version')
  const tailleEntete = dv.getUint16(94, true)
  const nbVlr = dv.getUint32(100, true)
  const formatPoint = tete[104] & 0x3f
  const longueurPoint = dv.getUint16(105, true)
  const f = (o: number) => dv.getFloat64(o, true)
  const entete = {
    formatPoint,
    longueurPoint,
    echelle: [f(131), f(139), f(147)] as [number, number, number],
    decalage: [f(155), f(163), f(171)] as [number, number, number],
    max: [f(179), f(195), f(211)] as [number, number, number],
    min: [f(187), f(203), f(219)] as [number, number, number],
    nbPoints: u64(dv, 247),
  }
  // Les VLR : 54 octets d'en-tête chacune, puis leur contenu.
  let o = tailleEntete
  for (let i = 0; i < nbVlr && o + 54 <= tete.byteLength; i++) {
    const utilisateur = String.fromCharCode(...tete.subarray(o + 2, o + 18)).replace(/\0+$/, '')
    const enregistrement = dv.getUint16(o + 18, true)
    const longueur = dv.getUint16(o + 20, true)
    if (utilisateur === 'copc' && enregistrement === 1) {
      const c = o + 54
      return {
        ...entete,
        centre: [f(c), f(c + 8), f(c + 16)],
        demiCote: f(c + 24),
        espacement: f(c + 32),
        racineHierarchie: { offset: u64(dv, c + 40), longueur: u64(dv, c + 48) },
      }
    }
    o += 54 + longueur
  }
  throw new Error('copc_info_absente')
}

/** Le carré (en plan) d'un nœud de l'octree. */
export function emprise(e: EnteteCopc, [d, x, y]: [number, number, number, number]): Zone {
  const cote = (2 * e.demiCote) / 2 ** d
  const x0 = e.centre[0] - e.demiCote + x * cote
  const y0 = e.centre[1] - e.demiCote + y * cote
  return { minX: x0, minY: y0, maxX: x0 + cote, maxY: y0 + cote }
}

const touche = (a: Zone, b: Zone) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

/**
 * Densité en dessous de laquelle un niveau de l'octree ne vaut pas sa lecture.
 *
 * Les niveaux grossiers couvrent toute la dalle d'un kilomètre : pour une
 * maison, on y décodait jusqu'à 900 000 points pour en garder 16 000. Leurs
 * points ne pèsent que quelques pour cent de la densité (environ 0,1 point par
 * m² à la racine, 0,4 au niveau suivant…) : on les laisse, et l'on garde la
 * quasi-totalité des points utiles pour une fraction des octets.
 */
export const DENSITE_MIN = 2

/**
 * Les nœuds dont le carré touche la zone, à tous les niveaux assez denses. Une
 * page de hiérarchie n'est lue que si sa racine touche la zone.
 */
export async function noeudsDansZone(
  lire: LireOctets,
  e: EnteteCopc,
  zone: Zone,
  densiteMin = DENSITE_MIN,
): Promise<Noeud[]> {
  const retenus: Noeud[] = []
  const pages = [e.racineHierarchie]
  while (pages.length) {
    const page = pages.pop()!
    const octets = await lire(page.offset, page.offset + page.longueur)
    const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
    for (let i = 0; i + 32 <= octets.byteLength; i += 32) {
      const cle: [number, number, number, number] = [
        dv.getInt32(i, true),
        dv.getInt32(i + 4, true),
        dv.getInt32(i + 8, true),
        dv.getInt32(i + 12, true),
      ]
      const carre = emprise(e, cle)
      if (!touche(carre, zone)) continue
      const offset = u64(dv, i + 16)
      const longueur = dv.getInt32(i + 24, true)
      const nbPoints = dv.getInt32(i + 28, true)
      if (nbPoints === -1) pages.push({ offset, longueur })
      else if (nbPoints > 0) {
        const aire = (carre.maxX - carre.minX) * (carre.maxY - carre.minY)
        if (nbPoints / aire >= densiteMin) retenus.push({ cle, offset, longueur, nbPoints })
      }
    }
  }
  return retenus
}

/** Des points, en Lambert-93 et en altitude IGN69, avec leur classe. */
export interface Nuage {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  classe: Uint8Array
  nb: number
}

/**
 * Lectures menées de front. Six faisaient répondre « 429, trop de requêtes »
 * au serveur de l'IGN : deux suffisent à couvrir sa lenteur.
 */
export const CONCURRENCE = 2

/**
 * Les classes gardées : 1 non classé, 2 sol, 3 à 5 végétation (basse, moyenne,
 * haute), 6 bâtiment, 9 eau, 17 pont, 64 sursol pérenne, 67 divers bâtis. Un
 * vide dans le nuage doit vouloir dire « rien vu », pas « classe écartée ».
 * On laisse les artefacts (65) et les points virtuels (66).
 */
export const CLASSES_UTILES = new Set([1, 2, 3, 4, 5, 6, 9, 17, 64, 67])

/**
 * Les points de la zone. Les nœuds voisins dans le fichier sont lus d'un seul
 * tenant (écart de moins de 64 ko) : moins d'allers-retours, pour quelques
 * octets de trop.
 */
export async function lirePoints(
  lire: LireOctets,
  e: EnteteCopc,
  noeuds: Noeud[],
  decompresser: Decompresseur,
  zone: Zone,
  classes: Set<number> = CLASSES_UTILES,
): Promise<{ nuage: Nuage; octetsLus: number }> {
  const tri = [...noeuds].sort((a, b) => a.offset - b.offset)
  const blocs: { debut: number; fin: number; noeuds: Noeud[] }[] = []
  for (const n of tri) {
    const dernier = blocs[blocs.length - 1]
    if (dernier && n.offset - dernier.fin < 65536) {
      dernier.fin = Math.max(dernier.fin, n.offset + n.longueur)
      dernier.noeuds.push(n)
    } else blocs.push({ debut: n.offset, fin: n.offset + n.longueur, noeuds: [n] })
  }

  const x: number[] = [], y: number[] = [], z: number[] = [], cl: number[] = []
  let octetsLus = 0
  const L = e.longueurPoint
  // Le serveur de l'IGN met une à deux secondes par lecture : on en mène
  // plusieurs de front.
  const lus = await parLots(blocs, CONCURRENCE, (b) => lire(b.debut, b.fin))
  for (let k = 0; k < blocs.length; k++) {
    const b = blocs[k]
    const octets = lus[k]
    octetsLus += octets.byteLength
    for (const n of b.noeuds) {
      const brut = await decompresser(
        octets.subarray(n.offset - b.debut, n.offset - b.debut + n.longueur),
        n.nbPoints,
        e.formatPoint,
        L,
      )
      const dv = new DataView(brut.buffer, brut.byteOffset, brut.byteLength)
      for (let i = 0; i < n.nbPoints; i++) {
        const o = i * L
        // Formats 6 à 8 : la classe est à l'octet 16.
        const c = brut[o + 16]
        if (!classes.has(c)) continue
        const px = dv.getInt32(o, true) * e.echelle[0] + e.decalage[0]
        const py = dv.getInt32(o + 4, true) * e.echelle[1] + e.decalage[1]
        if (px < zone.minX || px > zone.maxX || py < zone.minY || py > zone.maxY) continue
        x.push(px)
        y.push(py)
        z.push(dv.getInt32(o + 8, true) * e.echelle[2] + e.decalage[2])
        cl.push(c)
      }
    }
  }
  return {
    nuage: { x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z), classe: Uint8Array.from(cl), nb: x.length },
    octetsLus,
  }
}

/** `f` sur chaque élément, `n` à la fois, dans l'ordre. */
async function parLots<T, R>(elements: T[], n: number, f: (e: T) => Promise<R>): Promise<R[]> {
  const sortie: R[] = new Array(elements.length)
  let suivant = 0
  const ouvriers = Array.from({ length: Math.min(n, elements.length) }, async () => {
    while (suivant < elements.length) {
      const i = suivant++
      sortie[i] = await f(elements[i])
    }
  })
  await Promise.all(ouvriers)
  return sortie
}
