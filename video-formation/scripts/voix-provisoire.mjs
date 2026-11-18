// Voix PROVISOIRE (synthèse macOS) en attendant le tournage d'Antoine.
// Sert à caler le rythme des scènes et à valider la vidéo avant tournage.
// Écrit public/voix/<partie>.wav et src/calage.json.
// Usage : npm run voix-provisoire
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const racine = fileURLToPath(new URL('..', import.meta.url))
const source = await readFile(racine + 'src/script.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { PARTIES } = await import('data:text/javascript,' + encodeURIComponent(js))

const PAUSE = 0.7 // silence entre deux parties, en secondes
await mkdir(racine + 'public/voix', { recursive: true })

/** Durée d'un WAV PCM d'après son en-tête. */
async function dureeWav(chemin) {
  const b = await readFile(chemin)
  const debit = b.readUInt32LE(28)
  let i = 12
  while (i < b.length) {
    const id = b.toString('ascii', i, i + 4)
    const taille = b.readUInt32LE(i + 4)
    if (id === 'data') return taille / debit
    i += 8 + taille
  }
  throw new Error('WAV sans données : ' + chemin)
}

let t = 0.5
const parties = []
for (const p of PARTIES) {
  const texte = p.texte.join(' ').replace(/[«»]/g, '').replace(/—/g, ',').replace(/\s+/g, ' ')
  const fichier = `voix/${p.id}.wav`
  execFileSync('say', ['-v', 'Thomas', '-r', '178', '--file-format=WAVE', '--data-format=LEI16@24000', '-o', racine + 'public/' + fichier, texte])
  await stat(racine + 'public/' + fichier)
  const duree = await dureeWav(racine + 'public/' + fichier)
  parties.push({ id: p.id, debut: +t.toFixed(3), fin: +(t + duree).toFixed(3), audio: fichier })
  t += duree + PAUSE
}
// 3 s de plus pour laisser le mot de la fin à l'écran.
const calage = { source: 'provisoire', duree: +(t - PAUSE + 3).toFixed(3), parties }
await writeFile(racine + 'src/calage.json', JSON.stringify(calage, null, 2) + '\n')
console.log(`Voix provisoire : ${parties.length} parties, ${Math.floor(calage.duree / 60)} min ${Math.round(calage.duree % 60)} s`)
