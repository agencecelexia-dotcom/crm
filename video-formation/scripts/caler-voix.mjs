// Cale la vidéo sur le tournage d'Antoine.
//
//   npm run caler-voix -- dossier/des/clips   [--cadrage 50%,35%]   (recommandé)
//   npm run caler-voix -- une-seule-video.mov [--cadrage 50%,35%]
//
// DOSSIER : une vidéo par partie, dans l'ordre alphabétique de leurs noms
// (01.mov, 02.mov… ou les noms d'origine du téléphone, qui suivent l'ordre de
// tournage). Elles sont mises bout à bout ; chaque partie commence à son clip.
//
// UNE SEULE VIDÉO : Antoine marque ~2 s de silence entre les parties. Les plus
// longs silences, autant que de transitions, donnent le début de chacune.
//
// Résultat : public/antoine.mp4 (son + image de la bulle) et src/calage.json.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const racine = fileURLToPath(new URL('..', import.meta.url))
const [source, ...options] = process.argv.slice(2)
if (!source) {
  console.error('Usage : npm run caler-voix -- <dossier de clips | vidéo unique> [--cadrage 50%,35%]')
  process.exit(1)
}
const iCadrage = options.indexOf('--cadrage')
const cadrage = iCadrage >= 0 ? options[iCadrage + 1].replace(',', ' ') : '50% 35%'

const script = await readFile(racine + 'src/script.ts', 'utf8')
const js = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { PARTIES } = await import('data:text/javascript,' + encodeURIComponent(js))

/** ffmpeg fourni par Remotion ; il écrit ses informations sur la sortie d'erreur. */
function ffmpeg(args) {
  const r = spawnSync('npx', ['remotion', 'ffmpeg', '-hide_banner', ...args], { cwd: racine, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(String(r.stderr || r.error).slice(-2000))
  return `${r.stdout}\n${r.stderr}`
}
const SILENCE = (d) => ['-vn', '-af', `silencedetect=noise=-32dB:d=${d}`, '-f', 'null', '-']
function silences(fichier, d) {
  const j = ffmpeg(['-i', fichier, ...SILENCE(d)])
  const duree = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(j)?.slice(1).reduce((t, v, i) => t + Number(v) * [3600, 60, 1][i], 0))
  const debuts = [...j.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])))
  const fins = [...j.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  return { duree, liste: debuts.map((d0, i) => ({ debut: d0, fin: fins[i] ?? duree, duree: (fins[i] ?? duree) - d0 })) }
}
/** Encodage unique, lisible par le moteur de rendu (H.264 + AAC, 1080 px de haut max). */
const encoder = (entree, sortie, avant = []) => ffmpeg(['-y', ...avant, '-i', entree, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', sortie])

const cible = racine + 'public/antoine.mp4'
const transitions = PARTIES.length - 1
let parties
let duree

if ((await stat(source)).isDirectory()) {
  const clips = (await readdir(source)).filter((f) => /\.(mov|mp4|m4v)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
  if (clips.length !== PARTIES.length) {
    console.error(`${clips.length} vidéos trouvées, ${PARTIES.length} attendues (une par partie) :`)
    clips.forEach((c, i) => console.error(`  ${String(i + 1).padStart(2)}. ${c}`))
    process.exit(1)
  }
  // Chaque clip est réencodé à l'identique, puis les morceaux sont collés sans perte.
  const tmp = await mkdtemp(join(tmpdir(), 'clips-antoine-'))
  const morceaux = []
  parties = []
  let t = 0
  for (const [i, clip] of clips.entries()) {
    const morceau = join(tmp, `${String(i).padStart(2, '0')}.mp4`)
    encoder(join(source, clip), morceau)
    const { duree: d, liste } = silences(morceau, 0.3)
    // Parole : après le silence d'ouverture, avant celui de clôture. Le
    // « clic » de début d'enregistrement peut précéder le silence d'ouverture.
    const ouverture = liste.find((s) => s.debut < 0.6)
    const cloture = liste.findLast((s) => s.fin >= d - 0.15 && s !== ouverture)
    parties.push({ id: PARTIES[i].id, debut: +(t + (ouverture?.fin ?? 0)).toFixed(3), fin: +(t + (cloture?.debut ?? d)).toFixed(3) })
    morceaux.push(morceau)
    t += d
    console.log(`  ${String(i + 1).padStart(2)}. ${clip} → ${PARTIES[i].id} (${d.toFixed(1)} s)`)
  }
  await writeFile(join(tmp, 'liste.txt'), morceaux.map((m) => `file '${m}'`).join('\n'))
  ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'liste.txt'), '-c', 'copy', '-movflags', '+faststart', cible])
  await rm(tmp, { recursive: true, force: true })
  duree = t
} else {
  encoder(source, cible)
  const { duree: d, liste } = silences(cible, 1.2)
  duree = d
  const ouverture = liste.find((s) => s.debut < 0.3)
  const cloture = liste.find((s) => s.fin >= d - 0.3)
  const internes = liste.filter((s) => s !== ouverture && s !== cloture)
  if (internes.length < transitions) {
    console.error(`Seulement ${internes.length} silences trouvés pour ${transitions} transitions.`)
    console.error('Antoine a-t-il bien marqué ~2 s de silence entre chaque partie ? Sinon : un clip par partie (dossier).')
    process.exit(1)
  }
  const coupures = [...internes].sort((a, b) => b.duree - a.duree).slice(0, transitions).sort((a, b) => a.debut - b.debut)
  parties = PARTIES.map((p, i) => ({
    id: p.id,
    debut: +(i === 0 ? ouverture?.fin ?? 0 : coupures[i - 1].fin).toFixed(3),
    fin: +(i === transitions ? cloture?.debut ?? d : coupures[i].debut).toFixed(3),
  }))
}

// Le mot de la fin reste 3 s à l'écran, même si la vidéo s'arrête net.
const total = Math.max(duree, parties.at(-1).fin + 3)
await writeFile(racine + 'src/calage.json', JSON.stringify({ source: 'antoine', video: 'antoine.mp4', cadrage, duree: +total.toFixed(3), parties }, null, 2) + '\n')

console.log(`\nCalage sur la voix d'Antoine : ${Math.floor(total / 60)} min ${Math.round(total % 60)} s`)
for (const p of parties) console.log(`  ${p.id.padEnd(12)} ${p.debut.toFixed(1).padStart(6)} s → ${p.fin.toFixed(1).padStart(6)} s`)
console.log('\nVérifier : npm run apercu   ·   Produire : npm run rendu')
