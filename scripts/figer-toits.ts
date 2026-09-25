// Fige les grilles d'altitude de l'IGN pour quelques maisons réelles, afin
// que les tests rejouent le calcul du toit sans réseau ni étranglement.
//
//   npx jiti scripts/figer-toits.ts <nom> <cleabs> <lon> <lat> [description]
//
// Écrit `tests/fixtures/lidar/<nom>/` : les GeoTIFF bruts tels que l'IGN les
// a servis, le contour du bâtiment, et le résultat attendu. Lecture seule sur
// l'IGN, une maison à la fois.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { grilleIgn, mesurerToit } from '../supabase/functions/_calcul-toit.ts'
import { parCleabs } from '../supabase/functions/_batiment.ts'

const [nom, cleabs, lon, lat, ...description] = process.argv.slice(2)
if (!nom || !cleabs || !lon || !lat) {
  console.error('usage : figer-toits.ts <nom> <cleabs> <lon> <lat> [description]')
  process.exit(1)
}

const [b] = await parCleabs([cleabs], [[Number(lon), Number(lat)]])
if (!b) throw new Error(`bâtiment ${cleabs} introuvable autour de ${lon}, ${lat}`)

const dossier = join('tests/fixtures/lidar', nom)
mkdirSync(dossier, { recursive: true })
const grilles: Record<string, string> = {}
const resultat = await mesurerToit(b.contour, async (couche, ...cadre) => {
  const brut = await grilleIgn(couche, ...cadre)
  const fichier = `${couche.replace(/[^A-Za-z0-9]+/g, '_')}.tif`
  writeFileSync(join(dossier, fichier), Buffer.from(brut))
  grilles[couche] = fichier
  return brut
})

// La date de mesure change à chaque passage : elle n'a rien à faire dans un attendu.
const attendu: Record<string, unknown> = { ...resultat }
delete attendu.mesure_le
writeFileSync(
  join(dossier, 'maison.json'),
  JSON.stringify({ nom, description: description.join(' ') || null, cleabs, contour: b.contour, grilles, attendu }, null, 1) + '\n',
)
console.log(nom, JSON.stringify(attendu).slice(0, 240))
