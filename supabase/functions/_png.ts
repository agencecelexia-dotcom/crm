// Un encodeur PNG minimal : des pixels RGBA en octets. Sans dépendance : la
// compression passe par `CompressionStream` (Deno, navigateurs, Node 18+).
// Sert à fabriquer les images que l'IA lit (`_preuves.ts`) sans bibliothèque.

const TABLE_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(octets: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function bloc(type: string, donnees: Uint8Array): Uint8Array {
  const sortie = new Uint8Array(12 + donnees.length)
  const dv = new DataView(sortie.buffer)
  dv.setUint32(0, donnees.length)
  for (let i = 0; i < 4; i++) sortie[4 + i] = type.charCodeAt(i)
  sortie.set(donnees, 8)
  dv.setUint32(8 + donnees.length, crc32(sortie.subarray(4, 8 + donnees.length)))
  return sortie
}

async function deflate(octets: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([octets as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(flux).arrayBuffer())
}

/** Des pixels RGBA (4 octets chacun, ligne par ligne) en fichier PNG. */
export async function encoderPng(rgba: Uint8Array, largeur: number, hauteur: number): Promise<Uint8Array> {
  const brut = new Uint8Array((largeur * 4 + 1) * hauteur)
  for (let y = 0; y < hauteur; y++) {
    brut[y * (largeur * 4 + 1)] = 0 // filtre « aucun »
    brut.set(rgba.subarray(y * largeur * 4, (y + 1) * largeur * 4), y * (largeur * 4 + 1) + 1)
  }
  const entete = new Uint8Array(13)
  const dv = new DataView(entete.buffer)
  dv.setUint32(0, largeur)
  dv.setUint32(4, hauteur)
  entete[8] = 8 // profondeur
  entete[9] = 6 // RGBA
  const parties = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc('IHDR', entete),
    bloc('IDAT', await deflate(brut)),
    bloc('IEND', new Uint8Array(0)),
  ]
  const sortie = new Uint8Array(parties.reduce((s, p) => s + p.length, 0))
  let k = 0
  for (const p of parties) {
    sortie.set(p, k)
    k += p.length
  }
  return sortie
}

async function inflate(octets: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([octets as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(flux).arrayBuffer())
}

export interface ImagePng {
  largeur: number
  hauteur: number
  /** Pixels RGBA, ligne par ligne. */
  rgba: Uint8Array
}

/**
 * Un PNG en pixels RGBA : 8 bits, sans entrelacement, niveaux de gris, RGB,
 * palette ou RGBA — ce que sert la Géoplateforme de l'IGN. Un autre format lève.
 */
export async function decoderPng(png: Uint8Array): Promise<ImagePng> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (png.length < 33 || sig.some((v, i) => png[i] !== v)) throw new Error('png_signature')
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let largeur = 0, hauteur = 0, profondeur = 0, type = 0, entrelace = 0
  let palette: Uint8Array | null = null
  const morceaux: Uint8Array[] = []
  for (let k = 8; k + 12 <= png.length; ) {
    const n = dv.getUint32(k)
    const nom = String.fromCharCode(png[k + 4], png[k + 5], png[k + 6], png[k + 7])
    const corps = png.subarray(k + 8, k + 8 + n)
    if (nom === 'IHDR') {
      largeur = dv.getUint32(k + 8)
      hauteur = dv.getUint32(k + 12)
      profondeur = png[k + 16]
      type = png[k + 17]
      entrelace = png[k + 20]
    } else if (nom === 'PLTE') palette = corps
    else if (nom === 'IDAT') morceaux.push(corps)
    else if (nom === 'IEND') break
    k += 12 + n
  }
  if (profondeur !== 8 || entrelace !== 0) throw new Error(`png_non_gere_${profondeur}_${entrelace}`)
  const canaux = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  if (!canaux || (type === 3 && !palette)) throw new Error(`png_type_${type}`)
  const total = morceaux.reduce((s, m) => s + m.length, 0)
  const zip = new Uint8Array(total)
  let o = 0
  for (const m of morceaux) {
    zip.set(m, o)
    o += m.length
  }
  const brut = await inflate(zip)
  const ligne = largeur * canaux
  const pix = new Uint8Array(ligne * hauteur)
  // Les cinq filtres du PNG : aucun, gauche, haut, moyenne, Paeth.
  for (let y = 0; y < hauteur; y++) {
    const f = brut[y * (ligne + 1)]
    const src = y * (ligne + 1) + 1
    for (let x = 0; x < ligne; x++) {
      const v = brut[src + x]
      const a = x >= canaux ? pix[y * ligne + x - canaux] : 0
      const b = y > 0 ? pix[(y - 1) * ligne + x] : 0
      const c = x >= canaux && y > 0 ? pix[(y - 1) * ligne + x - canaux] : 0
      let p = v
      if (f === 1) p = v + a
      else if (f === 2) p = v + b
      else if (f === 3) p = v + ((a + b) >> 1)
      else if (f === 4) {
        const q = a + b - c
        const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c)
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      pix[y * ligne + x] = p & 0xff
    }
  }
  const rgba = new Uint8Array(largeur * hauteur * 4)
  for (let i = 0; i < largeur * hauteur; i++) {
    const s = i * canaux, d = i * 4
    if (type === 6) rgba.set(pix.subarray(s, s + 4), d)
    else if (type === 2) rgba.set([pix[s], pix[s + 1], pix[s + 2], 255], d)
    else if (type === 0) rgba.set([pix[s], pix[s], pix[s], 255], d)
    else if (type === 4) rgba.set([pix[s], pix[s], pix[s], pix[s + 1]], d)
    else rgba.set([palette![pix[s] * 3], palette![pix[s] * 3 + 1], palette![pix[s] * 3 + 2], 255], d)
  }
  return { largeur, hauteur, rgba }
}
