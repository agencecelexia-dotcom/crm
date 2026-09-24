// Edge Function : la pente d'un toit, mesurée et non plus devinée.
//
// CE QU'ELLE REMPLACE
//
// Jusqu'ici la pente venait des altitudes de la BD TOPO : faîtage moins
// gouttière, rapporté à la demi-largeur du bâtiment. La précision altimétrique
// d'un mètre y laissait une marge de ±27 à ±61 POINTS — un chiffre indéfendable,
// que l'audit a justement traité de bruit habillé.
//
// L'IGN diffuse gratuitement, sans clé, le modèle numérique de surface issu du
// LiDAR HD : une grille d'altitudes à CINQUANTE CENTIMÈTRES. La pente n'y est
// plus déduite d'une hypothèse de toit à deux pans, elle est LUE dans la donnée,
// pixel par pixel. Écart interquartile mesuré sur des maisons réelles : ±2 à
// ±10 points, et les versants ressortent par paires opposées — ce que doit
// donner un toit à deux pans.
//
// DEUX SOURCES, ANNONCÉES COMME TELLES
//
// Le LiDAR HD couvre 90 % de la population, pas le territoire : Lille est un
// trou de 22 km de côté. Là où il manque, on retombe sur le MNS
// photogrammétrique, à un mètre, disponible partout. Il est moins bon — l'écart
// médian au LiDAR vaut deux degrés, et un toit sur huit dépasse cinq. L'écran
// le dit : la source et l'incertitude accompagnent toujours le chiffre.
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
//    réessais sur l'échec de CONNEXION, et surtout un cache.

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

function cors(origin: string | null) {
  const ok = origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const json = (b: unknown, s: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...h, 'content-type': 'application/json' } })

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

function versLambert93(lon: number, lat: number): [number, number] {
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

interface Grille { w: number; h: number; px: Float32Array }

function lireGeoTiff(ab: ArrayBuffer): Grille {
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

/** Une grille d'altitudes, avec délai de garde et réessais sur la connexion. */
async function grille(
  couche: string, x0: number, y0: number, x1: number, y1: number, w: number, h: number,
): Promise<Grille> {
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
      return lireGeoTiff(await r.arrayBuffer())
    } catch (e) {
      derniere = e
      await new Promise((r) => setTimeout(r, 800 * (essai + 1)))
    }
  }
  throw derniere instanceof Error ? derniere : new Error('wms_injoignable')
}

/** Un point est-il dans le polygone ? Lancer de rayon, en coordonnées métriques. */
function dedans(x: number, y: number, P: [number, number][]): boolean {
  let d = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (
      P[i][1] > y !== P[j][1] > y &&
      x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]
    ) d = !d
  }
  return d
}

const quantile = (a: number[], q: number) => a[Math.min(a.length - 1, Math.floor(a.length * q))]
const CARDINAUX = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']

interface Mesure {
  pente: number
  incertitude: number
  pixels: number
  versants: { orientation: string; part: number }[]
}

/**
 * La pente d'un toit, lue dans deux grilles d'altitude.
 *
 * @param surface le modèle de SURFACE — c'est son gradient qui donne la pente.
 * @param hauteurSol la hauteur au-dessus du sol en chaque pixel, qui sert
 *   uniquement à écarter ce qui n'est pas du toit : cours, passages, ombres.
 */
function calculer(
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
      // L'exposition d'un versant : la direction de la plus grande DESCENTE.
      if (p > 15) {
        const az = (((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI) % 360 + 360) % 360
        bacs[Math.round(az / 45) % 8]++
      }
    }
  }
  if (pentes.length < minPixels) return null

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
  }
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

interface MurMesure {
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

function mesurerMurs(
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
function hauteursToit(mnh: Grille, poly: [number, number][], x0: number, y0: number, pas: number) {
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

const LIDAR = 'IGNF_LIDAR-HD_{C}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { token, contour, cleabs, rafraichir } = (await req.json()) ?? {}
    if (typeof token !== 'string' || !Array.isArray(contour) || contour.length < 3) {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }
    if (await rpc('token_artisan_valide', { p_token: token }) !== true) {
      return json({ ok: false, error: 'token_invalide' }, 403, CORS)
    }

    // Un toit ne bouge pas. Chaque mesure évitée épargne deux images à l'IGN,
    // cinq secondes à l'artisan, et protège les appels suivants de l'étranglement.
    const cle = typeof cleabs === 'string' && cleabs.trim() ? cleabs.trim() : null
    if (cle && !rafraichir) {
      const c = await rpc('toiture_by_token', { p_token: token, p_cleabs: cle })
      const v = c as { trouvee?: boolean; couvert?: boolean; motif?: string | null; version?: number }
      // Le cache garde `motif` mais pas `fiable` : c'est la même chose dite
      // autrement, et une colonne de moins à tenir cohérente.
      // Une mesure antérieure aux murs (version 1) est refaite : la servir
      // laisserait l'onglet Façades sur la hauteur de la BD TOPO.
      if (v?.trouvee && (v.version ?? 1) >= 2) {
        return json({ ok: true, cache: true, ...(c as object), fiable: !!v.couvert && !v.motif }, 200, CORS)
      }
    }

    // Le contour arrive en degrés ; tout le calcul se fait en mètres.
    const poly = (contour as [number, number][]).map(([lon, lat]) => versLambert93(lon, lat))
    const xs = poly.map((p) => p[0])
    const ys = poly.map((p) => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    if (maxX - minX > 300 || maxY - minY > 300) {
      return json({ ok: false, error: 'batiment_trop_grand' }, 400, CORS)
    }

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
        grille(LIDAR.replace('{C}', 'MNS'), x0, y0, x0 + W * pas, y0 + H * pas, W, H),
        grille(LIDAR.replace('{C}', 'MNH'), x0, y0, x0 + W * pas, y0 + H * pas, W, H),
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
        grille('ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS', x0, y0, x0 + W * pas, y0 + H * pas, W, H),
        grille('ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES', x0, y0, x0 + W * pas, y0 + H * pas, W, H),
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

    if (!mesure) {
      const motif = aucuneDonnee ? 'hors_couverture' : 'trop_peu_de_toit'
      const r = { ok: true, couvert: false, motif }
      if (cle) await rpc('enregistrer_toiture', {
        p_cleabs: cle, p_couvert: false, p_motif: motif,
        p_pente: null, p_incertitude: null, p_pixels: null, p_versants: [], p_source: null,
      }).catch(() => {})
      return json(r, 200, CORS)
    }

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

    const sortie = {
      ok: true,
      couvert: true,
      fiable,
      motif: fiable ? null : 'toit_sans_pan_dominant',
      pente: Math.round(mesure.pente),
      incertitude,
      pixels: mesure.pixels,
      versants: mesure.versants,
      source,
      mesure_le: new Date().toISOString(),
      murs,
      hauteur_gouttiere: hauteurs?.gouttiere ?? null,
      hauteur_faitage: hauteurs?.faitage ?? null,
    }
    if (cle) await rpc('enregistrer_toiture', {
      p_cleabs: cle, p_couvert: true, p_motif: sortie.motif,
      p_pente: sortie.pente, p_incertitude: sortie.incertitude,
      p_pixels: sortie.pixels, p_versants: sortie.versants, p_source: source,
      p_murs: murs, p_hauteur_gouttiere: sortie.hauteur_gouttiere,
      p_hauteur_faitage: sortie.hauteur_faitage, p_version: 2,
    }).catch(() => {})

    return json(sortie, 200, CORS)
  } catch (e) {
    console.error('toiture-lidar', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
