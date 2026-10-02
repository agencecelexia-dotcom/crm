// Les vues que l'IA regarde, pour une maison figée : la photo aérienne avec sa
// grille, et les quatre vues obliques calculées. Pour LES REGARDER avant de les
// lui donner. Il faut le réseau (la photo vient de l'IGN).
//
//   npx jiti scripts/rendre-vues.ts <dossier-de-sortie> <nom> [<nom>…]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { decoderNuage } from '../supabase/functions/_nuage.ts'
import { cadreDeLaMaison } from '../supabase/functions/_preuves.ts'
import type { Releve } from '../supabase/functions/_releve.ts'
import { chargerOrtho, reliefDe, vueDessus, vueOblique } from '../supabase/functions/_vues-ia.ts'

const [sortie, ...noms] = process.argv.slice(2)
if (!sortie || !noms.length) {
  console.error('usage : rendre-vues.ts <dossier-de-sortie> <nom> [<nom>…]')
  process.exit(1)
}
mkdirSync(sortie, { recursive: true })
for (const nom of noms) {
  const dossier = join('tests/fixtures/copc', nom)
  const r = JSON.parse(readFileSync(join(dossier, 'releve.json'), 'utf8')) as Releve
  const nuage = decoderNuage(new Uint8Array(gunzipSync(readFileSync(join(dossier, 'nuage.bin.gz')))))
  const tresFine = r.ortho5cm === true
  const cadre = cadreDeLaMaison(r, tresFine ? 5 : 20, 10)
  let t = performance.now()
  const ortho = await chargerOrtho(cadre, tresFine)
  console.log(nom, 'photo', ortho.largeur, '×', ortho.hauteur, `${Math.round(performance.now() - t)} ms`)
  writeFileSync(join(sortie, `${nom}-dessus.png`), await vueDessus(ortho))
  t = performance.now()
  const relief = reliefDe(nuage, cadre)
  for (const v of ['nord', 'sud', 'est', 'ouest'] as const) {
    writeFileSync(join(sortie, `${nom}-${v}.png`), await vueOblique(relief, ortho, v))
  }
  console.log(nom, '4 vues obliques', `${Math.round(performance.now() - t)} ms`)
}
