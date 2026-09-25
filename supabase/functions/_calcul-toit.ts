// Le calcul d'un toit à partir des grilles d'altitude de l'IGN — sans Deno,
// sans base : la fonction `toiture-lidar`, les tests unitaires (sur des
// grilles réelles figées) et le banc de justesse lisent le même code.
//
// L'IGN diffuse gratuitement, sans clé, le modèle numérique de surface issu du
// LiDAR HD : une grille d'altitudes à CINQUANTE CENTIMÈTRES. La pente n'y est
// pas déduite d'une hypothèse de toit à deux pans, elle est LUE dans la donnée,
// pixel par pixel. Là où le LiDAR manque (Lille est un trou de 22 km de côté),
// on retombe sur le MNS photogrammétrique, à un mètre, moins bon — et on le dit.
//
// CINQ PIÈGES, TOUS PAYÉS COMPTANT
//
// 1. HORS COUVERTURE, LE SERVICE NE DIT PAS NON. Il renvoie un GeoTIFF
//    parfaitement valide, en HTTP 200, entièrement rempli de −9999. Il faut
//    compter les pixels invalides.
// 2. LA PENTE EST LE GRADIENT DU MNS, PAS DU MNH. Le modèle de hauteur au-dessus
//    du sol semble plus commode, mais sur un terrain en pente il ajoute la pente
//    du terrain à celle du toit. Le MNH ne sert qu'à séparer le toit du sol.
// 3. UNE COORDONNÉE À DIX-SEPT CHIFFRES casse l'analyseur géométrique du serveur.
//    Toute coordonnée est arrondie.
// 4. LA LIGNE 0 DE LA GRILLE EST AU NORD — vérifié sur la rive sud du Léman, où
//    la moitié haute de la grille tombe bien sur le lac. L'inverser retournerait
//    l'exposition des versants.
// 5. LE SERVICE ÉTRANGLE PAR L'IP, pas par un code HTTP. En rafale, la connexion
//    est mise en attente sans réponse. D'où un délai de garde généreux, des
//    réessais sur l'échec de CONNEXION, et surtout un cache (côté fonction).

// ---------- Lambert-93 ----------
//
// On demande la grille en Lambert-93 plutôt qu'en degrés : sinon le serveur
// rééchantillonne sa grille métrique native, ce qui lisse les arêtes de toit —
// c'est-à-dire précisément ce qu'on vient chercher.

const A_E = 0.0818191910428158
const A_N = 0.7256077650
const A_C = 11754255.426
const A_XS = 700000
const A_YS = 12655612.0499
const rad = (d: number) => (d * Math.PI) / 180

export function versLambert93(lon: number, lat: number): [number, number] {
  const p = rad(lat)
  const iso = Math.log(
    Math.tan(Math.PI / 4 + p / 2) *
      Math.pow((1 - A_E * Math.sin(p)) / (1 + A_E * Math.sin(p)), A_E / 2),
  )
  const R = A_C * Math.exp(-A_N * iso)
  const g = A_N * (rad(lon) - rad(3))
  return [A_XS + R * Math.sin(g), A_YS - R * Math.cos(g)]
}

// ---------- Lecture du GeoTIFF ----------
//
// Le flux de l'IGN est un TIFF classique, petit-boutiste, mono-bande, float32,
// non compressé, en une seule bande. Quarante lignes suffisent, et aucune
// bibliothèque : `geotiff` pèserait trois cent dix-neuf kilo-octets pour ceci.

export interface Grille { w: number; h: number; px: Float32Array }

export function lireGeoTiff(ab: ArrayBuffer): Grille {
  const dv = new DataView(ab)
  const pb = String.fromCharCode(dv.getUint8(0), dv.getUint8(1)) === 'II'
  if (dv.getUint16(2, pb) !== 42) throw new Error('tiff_inattendu')

  const ifd = dv.getUint32(4, pb)
  const n = dv.getUint16(ifd, pb)
  const T: Record<number, number> = {}
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    const tag = dv.getUint16(e, pb)
    const type = dv.getUint16(e + 2, pb)
    const nb = dv.getUint32(e + 4, pb)
    const taille = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 } as Record<number, number>)[type] ?? 1
    const off = taille * nb <= 4 ? e + 8 : dv.getUint32(e + 8, pb)
    if (type === 3) T[tag] = dv.getUint16(off, pb)
    else if (type === 4) T[tag] = dv.getUint32(off, pb)
  }

  if (T[259] !== 1) throw new Error('compression_inattendue')
  if (T[258] !== 32 || T[339] !== 3) throw new Error('pas_du_float32')

  const w = T[256]
  const h = T[257]
  // L'offset des données VARIE d'une requête à l'autre : jamais en dur.
  const off = T[273]
  const px = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) px[i] = dv.getFloat32(off + i * 4, pb)
  return { w, h, px }
}

/** Une grille d'altitudes brute (GeoTIFF), avec délai de garde et réessais sur la connexion. */
export async function grilleIgn(
  couche: string, x0: number, y0: number, x1: number, y1: number, w: number, h: number,
): Promise<ArrayBuffer> {
  const url =
    `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${couche}&FORMAT=image/geotiff&STYLES=&CRS=EPSG:2154` +
    `&BBOX=${x0.toFixed(2)},${y0.toFixed(2)},${x1.toFixed(2)},${y1.toFixed(2)}` +
    `&WIDTH=${w}&HEIGHT=${h}`

  let derniere: unknown
  for (let essai = 0; essai < 3; essai++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 20000)
      const r = await fetch(url, { signal: ctrl.signal })
      clearTimeout(t)
      if (!r.ok) throw new Error(`wms_${r.status}`)
      return await r.arrayBuffer()
    } catch (e) {
      derniere = e
      await new Promise((r) => setTimeout(r, 800 * (essai + 1)))
    }
  }
  throw derniere instanceof Error ? derniere : new Error('wms_injoignable')
}

/** Un point est-il dans le polygone ? Lancer de rayon, en coordonnées métriques. */
export function dedans(x: number, y: number, P: [number, number][]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (
      P[i][1] > y !== P[j][1] > y &&
      x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]
    ) d = !d
  }
  return d
}

export const quantile = (a: number[], q: number) => a[Math.min(a.length - 1, Math.floor(a.length * q))]
const CARDINAUX = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']

/** Un pan du toit : les pixels qui regardent dans la même direction. */
export interface Pan {
  orientation: string
  /** Part des pixels du toit, pixels plats compris. */
  part: number
  /** Pente médiane des pixels du pan, en %. */
  pente: number
  /** Demi-écart interquartile des pentes du pan : ses pixels s'accordent-ils ? */
  incertitude: number
}

export interface Mesure {
  pente: number
  incertitude: number
  pixels: number
  versants: { orientation: string; part: number }[]
  /**
   * Surface vraie ÷ surface au sol, pan par pan : la part plate compte pour 1,
   * chaque pan pour √(1 + p²) à SA pente médiane. Juste quel que soit le toit
   * — deux pans, quatre, un pan raide contre un pan doux, une partie plate —,
   * là où une pente unique suppose tous les pans pareils.
   *
   * Pas la moyenne brute des pixels : quelques pixels très raides (le mur d'un
   * voisin plus haut, un ressaut) la gonflaient de 17 % sur un toit à 28 %.
   * Les médianes par pan y résistent, et un « pan » de plus de 150 % n'est
   * pas un toit : il est écarté.
   */
  facteur: number
  /** Part des pixels quasi plats (pente ≤ 10 %). */
  partPlate: number
  /** Les pans d'au moins 8 % du toit, du plus grand au plus petit. */
  pans: Pan[]
}

/** Seuil sous lequel un pixel compte pour plat. */
const PLAT_PCT = 10
/** Part minimale des pixels pour qu'une orientation soit un pan. */
const PAN_MIN = 0.08
/** Au-delà, ce n'est plus un pan de toit mais un mur ou un ressaut. */
const PAN_MAX_PCT = 150

/**
 * La pente d'un toit, lue dans deux grilles d'altitude.
 *
 * @param surface le modèle de SURFACE — c'est son gradient qui donne la pente.
 * @param hauteurSol la hauteur au-dessus du sol en chaque pixel, qui sert
 *   uniquement à écarter ce qui n'est pas du toit : cours, passages, ombres.
 */
export function calculer(
  surface: Grille, hauteurSol: Float32Array, poly: [number, number][],
  x0: number, y0: number, pas: number, minPixels: number,
): Mesure | null {
  const { w: W, h: H, px } = surface

  const estToit = new Uint8Array(W * H)
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c
      const x = x0 + (c + 0.5) * pas
      // La ligne 0 est au NORD : la latitude décroît quand la ligne croît.
      const y = y0 + (H - r - 0.5) * pas
      estToit[i] = dedans(x, y, poly) && hauteurSol[i] > 1.5 && px[i] > -9998 ? 1 : 0
    }
  }

  const pentes: number[] = []
  const bacs = new Array(8).fill(0)
  // Pan par pan : la pente de chaque pixel, rangée par exposition.
  const parPan: number[][] = Array.from({ length: 8 }, () => [])
  let plats = 0
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      const i = r * W + c
      // On écarte les bords : leur gradient enjambe le vide autour du toit, et
      // donnerait la hauteur du mur plutôt que la pente du toit.
      if (!estToit[i] || !estToit[i - 1] || !estToit[i + 1] || !estToit[i - W] || !estToit[i + W]) continue
      const dzdx = (px[i + 1] - px[i - 1]) / (2 * pas)
      const dzdy = (px[i - W] - px[i + W]) / (2 * pas)
      const p = Math.hypot(dzdx, dzdy) * 100
      pentes.push(p)
      if (p <= PLAT_PCT) {
        plats++
        continue
      }
      // L'exposition d'un versant : la direction de la plus grande DESCENTE.
      const az = (((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI) % 360 + 360) % 360
      const bac = Math.round(az / 45) % 8
      parPan[bac].push(p)
      if (p > 15) bacs[bac]++
    }
  }
  if (pentes.length < minPixels) return null

  const pans: Pan[] = parPan
    .map((v, i) => {
      const tri = [...v].sort((a, b) => a - b)
      return {
        orientation: CARDINAUX[i],
        part: v.length / pentes.length,
        pente: tri.length ? quantile(tri, 0.5) : 0,
        incertitude: tri.length ? (quantile(tri, 0.75) - quantile(tri, 0.25)) / 2 : 0,
      }
    })
    .filter((pan) => pan.part >= PAN_MIN)
    .sort((a, b) => b.part - a.part)

  pentes.sort((a, b) => a - b)
  const total = bacs.reduce((a: number, b: number) => a + b, 0)
  return {
    pente: quantile(pentes, 0.5),
    // La dispersion des pixels EST l'incertitude : elle dit à la fois le bruit
    // du capteur et la complexité du toit. Un toit simple donne deux points,
    // un toit à plusieurs volumes en donne dix.
    incertitude: (quantile(pentes, 0.75) - quantile(pentes, 0.25)) / 2,
    pixels: pentes.length,
    versants: bacs
      .map((n: number, i: number) => ({ orientation: CARDINAUX[i], part: total ? n / total : 0 }))
      .filter((v: { part: number }) => v.part >= 0.1)
      .sort((a: { part: number }, b: { part: number }) => b.part - a.part),
    facteur: facteurParPans(plats / pentes.length, pans),
    partPlate: plats / pentes.length,
    pans,
  }
}

/** Voir `Mesure.facteur`. Les pixels hors pans retenus prennent la moyenne des pans retenus. */
export function facteurParPans(partPlate: number, pans: Pan[]): number {
  const retenus = pans.filter((p) => p.pente <= PAN_MAX_PCT)
  const poids = partPlate + retenus.reduce((s, p) => s + p.part, 0)
  if (poids <= 0) return 1
  return (partPlate + retenus.reduce((s, p) => s + p.part * Math.sqrt(1 + (p.pente / 100) ** 2), 0)) / poids
}


// ---------- Les murs, un par un ----------
//
// POURQUOI ON NE PREND PLUS LA HAUTEUR DE LA BD TOPO
//
// Elle a été comparée au LiDAR sur quinze maisons : l'écart atteint +3,6 à
// +4,8 m sur un tiers d'entre elles (11,7 m annoncés pour une gouttière à
// 6,9 m ; 6,7 m pour un toit dont le faîtage culmine à 6,0 m). Multipliée par
// la longueur, elle donnait des façades jusqu'à DEUX FOIS trop grandes. Et une
// hauteur unique ne dit ni le pignon, ni le terrain en pente, ni le côté bas.
//
// LA MESURE
//
// Le long de chaque mur, tous les 25 cm, on lit la hauteur du toit au-dessus
// du sol (MNH) juste à l'intérieur du contour. La surface du mur est
// l'intégrale de ce profil : un pignon ressort de lui-même en triangle, une
// maison sur un terrain en pente a un côté haut et un côté bas.
//
// Deux corrections :
// 1. On lit à 75 cm et à 125 cm à l'intérieur, pas sur la ligne du mur : le
//    bord du toit est flou d'un pixel. Sur un mur sous gouttière le toit
//    MONTE vers l'intérieur ; on prolonge la droite jusqu'à la ligne du mur,
//    sans quoi un toit à 100 % ajouterait 75 cm à la façade. Sur un pignon la
//    pente est parallèle au mur, les deux lectures sont égales et la
//    correction s'annule d'elle-même.
// 2. On lit aussi à 125 cm À L'EXTÉRIEUR. Si c'est haut dehors comme dedans,
//    le mur touche un autre volume — maison mitoyenne, garage accolé — et ce
//    n'est probablement pas une façade à traiter. On le dit, sans décider.

export interface MurMesure {
  /** Indice de l'arête dans le contour reçu : du sommet i au sommet i+1. */
  i: number
  longueur: number
  /** Surface du mur, en m², ouvertures non déduites. */
  surface: number
  hauteur_moyenne: number
  hauteur_min: number
  hauteur_max: number
  /** Part des points du mur où le toit a été trouvé. Sous 0,8, ne pas chiffrer. */
  valide: number
  /** Un autre volume touche ce mur sur la majeure partie de sa longueur. */
  accole: boolean
}

export function mesurerMurs(
  mnh: Grille, poly: [number, number][], x0: number, y0: number, pas: number,
): MurMesure[] {
  const { w, h, px } = mnh
  // Lecture bilinéaire sur les centres des pixels ; la ligne 0 est au nord.
  const lire = (x: number, y: number): number | null => {
    const fx = (x - x0) / pas - 0.5
    const fy = (y0 + h * pas - y) / pas - 0.5
    const c0 = Math.floor(fx), r0 = Math.floor(fy)
    const tx = fx - c0, ty = fy - r0
    let tot = 0, poids = 0
    for (const [dr, dc, pw] of [[0, 0, (1 - tx) * (1 - ty)], [0, 1, tx * (1 - ty)], [1, 0, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const r = r0 + dr, c = c0 + dc
      if (r >= 0 && r < h && c >= 0 && c < w && px[r * w + c] > -9998) { tot += px[r * w + c] * pw; poids += pw }
    }
    return poids > 0 ? tot / poids : null
  }

  let signe = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    signe += a[0] * b[1] - b[0] * a[1]
  }

  const sortie: MurMesure[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.3) continue
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
    // Normale INTÉRIEURE : à gauche du parcours si le contour tourne dans le sens trigonométrique.
    const nx = signe > 0 ? -uy : uy
    const ny = signe > 0 ? ux : -ux

    const k = Math.max(2, Math.round(L / 0.25))
    let surface = 0, n = 0, dehors = 0, somme = 0
    let hmin = Infinity, hmax = 0
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k
      const mx = a[0] + (b[0] - a[0]) * t, my = a[1] + (b[1] - a[1]) * t
      const h1 = lire(mx + nx * 0.75, my + ny * 0.75)
      const h2 = lire(mx + nx * 1.25, my + ny * 1.25)
      const ext = lire(mx - nx * 1.25, my - ny * 1.25)
      if (ext != null && ext > 2.5) dehors++
      if (h1 == null || h1 <= 1) continue
      // Le toit monte vers l'intérieur : on ramène la lecture à la ligne du
      // mur. Correction bornée à un mètre, pour qu'une lucarne ou un volume
      // plus haut en retrait ne fasse pas plonger la façade.
      const montee = h2 != null && h2 > h1 ? Math.min(1, ((h2 - h1) / 0.5) * 0.75) : 0
      const h0 = Math.max(0, h1 - montee)
      surface += h0 * (L / k)
      somme += h0
      n++
      if (h0 < hmin) hmin = h0
      if (h0 > hmax) hmax = h0
    }
    sortie.push({
      i,
      longueur: Math.round(L * 100) / 100,
      surface: Math.round(surface * 10) / 10,
      hauteur_moyenne: n ? Math.round((somme / n) * 10) / 10 : 0,
      hauteur_min: n ? Math.round(hmin * 10) / 10 : 0,
      hauteur_max: n ? Math.round(hmax * 10) / 10 : 0,
      valide: Math.round((n / k) * 100) / 100,
      accole: dehors / k >= 0.6,
    })
  }
  return sortie
}

/** Hauteurs du bâtiment : gouttière (bas du toit) et faîtage (haut), lues sur les pixels de toit. */
export function hauteursToit(mnh: Grille, poly: [number, number][], x0: number, y0: number, pas: number) {
  const { w, h, px } = mnh
  const v: number[] = []
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const val = px[r * w + c]
    if (val > 1.5 && dedans(x0 + (c + 0.5) * pas, y0 + (h - r - 0.5) * pas, poly)) v.push(val)
  }
  if (v.length < 25) return null
  v.sort((x, y) => x - y)
  return {
    gouttiere: Math.round(quantile(v, 0.08) * 10) / 10,
    faitage: Math.round(quantile(v, 0.98) * 10) / 10,
  }
}

export const LIDAR = 'IGNF_LIDAR-HD_{C}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'
export const PHOTO_MNS = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS'
export const PHOTO_MNT = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES'

/** Une grille brute, lue sur le réseau — ou dans un jeu d'essai figé. */
export type LireGrille = (
  couche: string, x0: number, y0: number, x1: number, y1: number, w: number, h: number,
) => Promise<ArrayBuffer>

export type ResultatToit =
  | { ok: true; couvert: false; motif: 'hors_couverture' | 'trop_peu_de_toit' }
  | {
      ok: true
      couvert: true
      fiable: boolean
      motif: 'toit_sans_pan_dominant' | null
      pente: number
      incertitude: number
      pixels: number
      versants: { orientation: string; part: number }[]
      source: string
      mesure_le: string
      murs: MurMesure[] | null
      hauteur_gouttiere: number | null
      hauteur_faitage: number | null
      /** Surface vraie ÷ surface au sol, pixel par pixel (voir `Mesure.facteur`). */
      facteur: number
      part_plate: number
      pans: Pan[]
    }

/**
 * Mesure un toit : pente, versants, murs, hauteurs.
 *
 * @param contour le contour du bâtiment, en degrés (longitude, latitude).
 * @param lire d'où viennent les grilles : l'IGN par défaut, un jeu d'essai en test.
 */
export async function mesurerToit(contour: [number, number][], lire: LireGrille = grilleIgn): Promise<ResultatToit> {
  const g = async (couche: string, x0: number, y0: number, x1: number, y1: number, w: number, h: number) =>
    lireGeoTiff(await lire(couche, x0, y0, x1, y1, w, h))

  // Le contour arrive en degrés ; tout le calcul se fait en mètres.
  const poly = contour.map(([lon, lat]) => versLambert93(lon, lat))
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  if (maxX - minX > 300 || maxY - minY > 300) throw new Error('batiment_trop_grand')

  // Une fenêtre serrée sur le bâtiment : trois mètres de marge suffisent à
  // laisser le gradient respirer, et chaque mètre de plus coûte des pixels.
  const cadre = (pas: number) => {
    const x0 = Math.floor((minX - 3) / pas) * pas
    const y0 = Math.floor((minY - 3) / pas) * pas
    return { x0, y0, W: Math.ceil((maxX + 3 - x0) / pas), H: Math.ceil((maxY + 3 - y0) / pas) }
  }

  let mesure: Mesure | null = null
  let source: string | null = null
  let incertitudeMin = 0
  // « Aucune donnée ici » et « bâtiment trop petit » appellent des réponses
  // opposées de l'artisan : la première lui dit de saisir la pente, la
  // seconde de vérifier qu'il a bien touché la maison. Les confondre, c'est
  // l'envoyer chercher au mauvais endroit.
  let aucuneDonnee = false
  let murs: MurMesure[] | null = null
  let hauteurs: { gouttiere: number; faitage: number } | null = null

  // ---- 1. Le LiDAR HD, quand il couvre : cinquante centimètres. ----
  {
    const pas = 0.5
    const { x0, y0, W, H } = cadre(pas)
    const [mns, mnh] = await Promise.all([
      g(LIDAR.replace('{C}', 'MNS'), x0, y0, x0 + W * pas, y0 + H * pas, W, H),
      g(LIDAR.replace('{C}', 'MNH'), x0, y0, x0 + W * pas, y0 + H * pas, W, H),
    ])
    // Hors couverture, le service répond un GeoTIFF valide plein de −9999.
    const invalides = mns.px.reduce((n, v) => n + (v <= -9998 ? 1 : 0), 0)
    if (invalides <= W * H * 0.5) {
      mesure = calculer(mns, mnh.px, poly, x0, y0, pas, 25)
      source = 'LiDAR HD de l’IGN, grille de 50 cm'
      // Les murs ne se mesurent qu'au LiDAR : à un mètre par pixel, la
      // photogrammétrie ne sépare pas le bord du toit du sol.
      murs = mesurerMurs(mnh, poly, x0, y0, pas)
      hauteurs = hauteursToit(mnh, poly, x0, y0, pas)
    }
  }

  // ---- 2. À défaut, la photogrammétrie : un mètre, mais partout. ----
  if (!mesure) {
    const pas = 1
    const { x0, y0, W, H } = cadre(pas)
    const [mns, mnt] = await Promise.all([
      g(PHOTO_MNS, x0, y0, x0 + W * pas, y0 + H * pas, W, H),
      g(PHOTO_MNT, x0, y0, x0 + W * pas, y0 + H * pas, W, H),
    ])
    // Ici, pas de modèle de hauteur tout fait : on le construit.
    const hauteur = new Float32Array(mns.px.length)
    for (let i = 0; i < hauteur.length; i++) {
      hauteur[i] = mns.px[i] > -9998 && mnt.px[i] > -9998 ? mns.px[i] - mnt.px[i] : -9999
    }
    // SOIXANTE-DIX PIXELS, PAS UN DE MOINS.
    //
    // Douze toits ont été mesurés dans les deux sources. L'écart médian de la
    // photogrammétrie au LiDAR vaut huit points — acceptable — mais la queue
    // monte à vingt-neuf. Or les trois pires cas ont tous MOINS DE SOIXANTE
    // pixels de toit, et tous ceux qui en ont plus de soixante-dix restent
    // sous huit points d'écart. La séparation est franche.
    //
    // À un mètre par pixel, soixante-dix pixels valent une maison d'environ
    // cent dix mètres carrés au sol. En dessous, la photogrammétrie ne sait
    // pas lire un toit, et l'on préfère le dire : c'est le cas d'à peu près
    // une maison sur vingt, qui garde la saisie à la main qu'elle a déjà.
    const vides = mns.px.reduce((n, v) => n + (v <= -9998 ? 1 : 0), 0)
    aucuneDonnee = vides > W * H * 0.5
    if (!aucuneDonnee) mesure = calculer(mns, hauteur, poly, x0, y0, pas, 70)
    source = 'Photogrammétrie de l’IGN, grille de 1 m'
    // Sous cette barre des soixante-dix pixels, l'écart observé ne dépasse
    // jamais huit points : dix est une annonce que la mesure tient.
    incertitudeMin = 10
  }

  if (!mesure) return { ok: true, couvert: false, motif: aucuneDonnee ? 'hors_couverture' : 'trop_peu_de_toit' }

  // UN TOIT SANS PAN DOMINANT NE SE MESURE PAS.
  //
  // Sur quatre maisons vérifiées, les deux versants principaux rassemblent 70
  // à 87 % des pixels : c'est la signature d'un toit à deux pans. Sur un îlot
  // urbain de Lille, le premier versant n'en tient que 19 % et les six
  // orientations se valent — il n'y a pas de pente à donner, seulement du
  // bruit. Servir 65 % avec ±65 d'incertitude, c'est le défaut que l'audit a
  // déjà reproché à la version précédente. On préfère l'admettre.
  const concentration = mesure.versants.slice(0, 2).reduce((s, v) => s + v.part, 0)
  const incertitude = Math.max(incertitudeMin, Math.round(mesure.incertitude))
  const fiable = concentration >= 0.45 && incertitude <= 30

  return {
    ok: true,
    couvert: true,
    fiable,
    motif: fiable ? null : 'toit_sans_pan_dominant',
    pente: Math.round(mesure.pente),
    incertitude,
    pixels: mesure.pixels,
    versants: mesure.versants,
    source: source!,
    mesure_le: new Date().toISOString(),
    murs,
    hauteur_gouttiere: hauteurs?.gouttiere ?? null,
    hauteur_faitage: hauteurs?.faitage ?? null,
    facteur: Math.round(mesure.facteur * 1000) / 1000,
    part_plate: Math.round(mesure.partPlate * 100) / 100,
    pans: mesure.pans.map((pan) => ({
      orientation: pan.orientation,
      part: Math.round(pan.part * 100) / 100,
      pente: Math.round(pan.pente),
      incertitude: Math.round(pan.incertitude),
    })),
  }
}
