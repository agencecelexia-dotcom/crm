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
