// Fige les points LiDAR HD d'une maison désignée par son ADRESSE, pour la mettre
// dans les jeux de tests (tests/fixtures/copc) sans rien saisir d'autre.
//
//   npx jiti scripts/figer-adresse.ts <nom> "<adresse>" <fin-du-cleabs> [description]
//
// Trouve la maison comme le fait l'outil (`identifierMaison`), vérifie que c'est
// bien le bâtiment attendu (le cleabs BD TOPO finit par <fin-du-cleabs>), télécharge
// les points, écrit tests/fixtures/copc/<nom>/ (nuage, maison, relevé). Il faut le
// réseau : l'IGN (Géoplateforme) et la Base Adresse Nationale. Lecture seule.
//
// Les quatre maisons de l'audit du 29/09/2026 :
//
//   npx jiti scripts/figer-adresse.ts oullins   "3 chemin des Mûriers 69310 Oullins-Pierre-Bénite" 242610441 "Immeuble à croupes, toit à 30 %"
//   npx jiti scripts/figer-adresse.ts nogent44  "44 rue François Rolland 94130 Nogent-sur-Marne" 243500516 "Maison mitoyenne, partie plate"
//   npx jiti scripts/figer-adresse.ts oucques1b "1b avenue Clémentine Martin 41290 Oucques La Nouvelle" 321387085 "Toit à 8 pans et annexes"
//   npx jiti scripts/figer-adresse.ts oucques6  "6 rue Henry Berthelemy 41290 Oucques La Nouvelle" 321387088 "Deux pans à 81 %"

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { lireEntete, lirePoints, noeudsDansZone, type Zone } from '../supabase/functions/_copc.ts'
import { versLambert93 } from '../supabase/functions/_calcul-toit.ts'
import { dallesPour, lecteurHttp } from '../supabase/functions/_lidar-hd.ts'
import { decompresserNode } from './laz-node.ts'
import { decoderNuage, encoderNuage } from '../supabase/functions/_nuage.ts'
import { releverBatiment } from '../supabase/functions/_releve.ts'
import { autour, identifierMaison } from '../supabase/functions/_batiment.ts'
import { routesAutour } from '../supabase/functions/_lecture-releve.ts'

const [nom, adresse, fin, ...description] = process.argv.slice(2)
if (!nom || !adresse || !fin) {
  console.error('usage : figer-adresse.ts <nom> "<adresse>" <fin-du-cleabs> [description]')
  process.exit(1)
}

const { reponse } = await identifierMaison({ adresse, codePostal: null, ville: null, point: null })
const principal = reponse.principal
if (!principal) throw new Error(`${nom} : aucune maison trouvée pour « ${adresse} » (${reponse.message ?? reponse.confiance})`)
if (!principal.cleabs.endsWith(fin)) {
  throw new Error(`${nom} : l'outil retient ${principal.cleabs}, pas le bâtiment attendu (…${fin}). Rien n'est écrit.`)
}
const { cleabs, contour } = principal
console.log(nom, ':', cleabs, `(${reponse.confiance}, à ${reponse.distance_m ?? '?'} m du numéro)`)

const poly = contour.map(([lon, lat]) => versLambert93(lon, lat))
const zone: Zone = {
  minX: Math.floor(Math.min(...poly.map((p) => p[0])) - 8),
  minY: Math.floor(Math.min(...poly.map((p) => p[1])) - 8),
  maxX: Math.ceil(Math.max(...poly.map((p) => p[0])) + 8),
  maxY: Math.ceil(Math.max(...poly.map((p) => p[1])) + 8),
}
const dalles = await dallesPour(zone)
if (!dalles.length) throw new Error(`${nom} : hors couverture LiDAR HD`)
const nuages = []
for (const d of dalles) {
  const lire = lecteurHttp(d.url)
  const e = await lireEntete(lire)
  const noeuds = await noeudsDansZone(lire, e, zone)
  nuages.push((await lirePoints(lire, e, noeuds, decompresserNode, zone)).nuage)
}

// Les bâtiments voisins et les routes, comme figer-nuages.ts.
const centre: [number, number] = [
  contour.reduce((s, p) => s + p[0], 0) / contour.length,
  contour.reduce((s, p) => s + p[1], 0) / contour.length,
]
const rayon = Math.hypot(zone.maxX - zone.minX, zone.maxY - zone.minY) / 2 + 5
const voisins = (await autour(centre, rayon))
  .filter((b) => b.cleabs !== cleabs)
  .filter((b) => {
    const l93 = b.contour.map(([lon, lat]) => versLambert93(lon, lat))
    return (
      Math.min(...l93.map((p) => p[0])) <= zone.maxX && Math.max(...l93.map((p) => p[0])) >= zone.minX &&
      Math.min(...l93.map((p) => p[1])) <= zone.maxY && Math.max(...l93.map((p) => p[1])) >= zone.minY
    )
  })
  .map((b) => ({ cleabs: b.cleabs, usage: b.usage, hauteur: b.hauteur, contour: b.contour }))
const routes = await routesAutour(zone)

const dossier = join('tests/fixtures/copc', nom)
mkdirSync(dossier, { recursive: true })
const binaire = encoderNuage(nuages, zone)
writeFileSync(join(dossier, 'nuage.bin.gz'), gzipSync(binaire))
const maison = {
  nom,
  description: description.join(' ') || adresse,
  cleabs,
  contour,
  zone,
  voisins,
  routes,
  dalles: dalles.map((d) => ({ vol: d.vol, fichier: d.url.split('/').pop() })),
}
writeFileSync(join(dossier, 'maison.json'), JSON.stringify(maison, null, 1) + '\n')
// Le relevé se fait sur les points TELS QU'ILS SERONT RELUS (centimètres) : le test « même relevé » les relit ainsi.
const r = releverBatiment({ nuage: decoderNuage(binaire), zone, contour, voisins: voisins.map((v) => v.contour), routes, vol: dalles[0].vol })
writeFileSync(join(dossier, 'releve.json'), JSON.stringify(r, null, 1) + '\n')
console.log(nom, ':', binaire.byteLength, 'octets,', r.pans.length, 'pans,', r.surfaces.toitVrai, 'm² de toit, gouttière', r.hauteurs.gouttiere, 'm, confiance', r.confiance)
