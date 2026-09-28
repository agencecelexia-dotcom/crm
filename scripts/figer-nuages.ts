// Fige les points LiDAR HD classés autour de quelques maisons réelles, pour
// développer et tester le relevé sans réseau.
//
//   npx jiti scripts/figer-nuages.ts [--voisins | --releve] <nom> [<nom>…]
//
// Lit le contour de tests/fixtures/lidar/<nom>/maison.json, et écrit
// tests/fixtures/copc/<nom>/ : `nuage.bin.gz` (points en centimètres autour de
// l'origine de la zone, avec leur classe) et `maison.json` (contour, voisins
// de la BD TOPO, zone, dalle, date du vol). `--voisins` ne relit que les
// voisins, sans retélécharger les points.
//
// `--releve` refige, sans réseau, le relevé attendu (`releve.json`) : à faire
// quand un calcul change VOLONTAIREMENT — le test « rend le même relevé »
// échoue jusque-là.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { lireEntete, lirePoints, noeudsDansZone, type Zone } from '../supabase/functions/_copc.ts'
import { versLambert93 } from '../supabase/functions/_calcul-toit.ts'
import { dallesPour, lecteurHttp } from '../supabase/functions/_lidar-hd.ts'
import { decompresserNode } from './laz-node.ts'
import { decoderNuage, encoderNuage } from '../supabase/functions/_nuage.ts'
import { releverBatiment } from '../supabase/functions/_releve.ts'
import { autour } from '../supabase/functions/_batiment.ts'

/** Les bâtiments de la BD TOPO qui touchent la zone, sauf la maison. */
async function voisinsDe(cleabs: string, contour: [number, number][], zone: Zone) {
  const centre: [number, number] = [
    contour.reduce((s, p) => s + p[0], 0) / contour.length,
    contour.reduce((s, p) => s + p[1], 0) / contour.length,
  ]
  const rayon = Math.hypot(zone.maxX - zone.minX, zone.maxY - zone.minY) / 2 + 5
  return (await autour(centre, rayon))
    .filter((b) => b.cleabs !== cleabs)
    .filter((b) => {
      const l93 = b.contour.map(([lon, lat]) => versLambert93(lon, lat))
      return (
        Math.min(...l93.map((p) => p[0])) <= zone.maxX && Math.max(...l93.map((p) => p[0])) >= zone.minX &&
        Math.min(...l93.map((p) => p[1])) <= zone.maxY && Math.max(...l93.map((p) => p[1])) >= zone.minY
      )
    })
    .map((b) => ({ cleabs: b.cleabs, usage: b.usage, hauteur: b.hauteur, contour: b.contour }))
}

const seulementVoisins = process.argv.includes('--voisins')
const seulementReleve = process.argv.includes('--releve')
for (const nom of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  if (seulementReleve) {
    const dossier = join('tests/fixtures/copc', nom)
    const m = JSON.parse(readFileSync(join(dossier, 'maison.json'), 'utf8'))
    const nuage = decoderNuage(new Uint8Array(gunzipSync(readFileSync(join(dossier, 'nuage.bin.gz')))))
    const r = releverBatiment({
      nuage,
      zone: m.zone,
      contour: m.contour,
      voisins: (m.voisins ?? []).map((v: { contour: [number, number][] }) => v.contour),
      vol: m.dalles[0]?.vol ?? null,
    })
    writeFileSync(join(dossier, 'releve.json'), JSON.stringify(r, null, 1) + '\n')
    console.log(nom, ':', r.pans.length, 'pans,', r.surfaces.toitVrai, 'm² de toit, confiance', r.confiance)
    continue
  }
  if (seulementVoisins) {
    const fichier = join('tests/fixtures/copc', nom, 'maison.json')
    if (!existsSync(fichier)) throw new Error(`${nom} : pas encore figé`)
    const m = JSON.parse(readFileSync(fichier, 'utf8'))
    const voisins = await voisinsDe(m.cleabs, m.contour, m.zone)
    const { dalles, ...reste } = m
    writeFileSync(fichier, JSON.stringify({ ...reste, voisins, dalles }, null, 1) + '\n')
    console.log(nom, ':', voisins.length, 'voisins')
    continue
  }
  const source = JSON.parse(readFileSync(join('tests/fixtures/lidar', nom, 'maison.json'), 'utf8'))
  const contour = source.contour as [number, number][]
  const poly = contour.map(([lon, lat]) => versLambert93(lon, lat))
  const zone: Zone = {
    minX: Math.floor(Math.min(...poly.map((p) => p[0])) - 8),
    minY: Math.floor(Math.min(...poly.map((p) => p[1])) - 8),
    maxX: Math.ceil(Math.max(...poly.map((p) => p[0])) + 8),
    maxY: Math.ceil(Math.max(...poly.map((p) => p[1])) + 8),
  }
  const dalles = await dallesPour(zone)
  if (!dalles.length) {
    console.log(nom, ': hors couverture')
    continue
  }
  const nuages = []
  for (const d of dalles) {
    const lire = lecteurHttp(d.url)
    const e = await lireEntete(lire)
    const noeuds = await noeudsDansZone(lire, e, zone)
    nuages.push((await lirePoints(lire, e, noeuds, decompresserNode, zone)).nuage)
  }
  const dossier = join('tests/fixtures/copc', nom)
  mkdirSync(dossier, { recursive: true })
  const binaire = encoderNuage(nuages, zone)
  writeFileSync(join(dossier, 'nuage.bin.gz'), gzipSync(binaire))
  writeFileSync(
    join(dossier, 'maison.json'),
    JSON.stringify(
      {
        nom,
        cleabs: source.cleabs,
        contour,
        zone,
        voisins: await voisinsDe(source.cleabs, contour, zone),
        dalles: dalles.map((d) => ({ vol: d.vol, fichier: d.url.split('/').pop() })),
      },
      null,
      1,
    ) + '\n',
  )
  console.log(nom, ':', binaire.byteLength, 'octets bruts,', nuages.reduce((s, n) => s + n.nb, 0), 'points, vol', dalles[0].vol)
}
