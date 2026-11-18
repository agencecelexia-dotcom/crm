// Produit SCRIPT-ANTOINE.md à partir de src/script.ts (source unique).
// Usage : npm run script-antoine
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const racine = fileURLToPath(new URL('..', import.meta.url))
const source = await readFile(racine + 'src/script.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { PARTIES } = await import('data:text/javascript,' + encodeURIComponent(js))

const mots = PARTIES.flatMap((p) => p.texte).join(' ').split(/\s+/).length
const minutes = mots / 150
const duree = `${Math.floor(minutes)} min ${String(Math.round((minutes % 1) * 60)).padStart(2, '0')}`

const lignes = [
  '# Vidéo « Votre espace artisan » — texte à lire',
  '',
  `Environ ${mots} mots, soit **${duree}** à un rythme posé.`,
  '',
  '## Avant de tourner',
  '',
  `- **Une petite vidéo par partie** : ${PARTIES.length} vidéos en tout, dans l’ordre. Tu te trompes ? Refilme la partie **tout de suite**, avant de passer à la suivante, et supprime la vidéo ratée : l’ordre des vidéos doit rester celui du texte.`,
  '- Dans chaque vidéo : lance l’enregistrement, **attends 1 seconde**, parle, **attends 1 seconde**, coupe.',
  '- Téléphone **à la verticale**, à hauteur des yeux, **posé** (pas tenu à la main), toujours au même endroit pour les 14 vidéos. Visage centré, avec de la marge autour : on le découpera en rond.',
  '- Face à une fenêtre ou une lumière douce, fond simple, **pièce calme** (pas de clim, pas de bruit de chantier). Un micro-cravate, si tu en as un.',
  '- Regarde l’objectif, souris, parle comme si tu expliquais à un artisan au téléphone. Pas besoin d’apprendre par cœur : lis tranquillement, phrase par phrase.',
  '- Les mots entre « guillemets » sont écrits tels quels sur l’écran de l’artisan : dis-les exactement.',
  '- Envoie les vidéos **originales** (AirDrop, WeTransfer ou Google Drive), **pas par WhatsApp** : il les compresse.',
  '',
]
PARTIES.forEach((p, i) => {
  lignes.push('———', '', `## Vidéo ${i + 1} sur ${PARTIES.length} · ${p.titre}`, '', ...p.texte.flatMap((t) => [t, '']))
})
lignes.push('———', '', '*Dernière vidéo : garde 2 secondes de sourire avant de couper.*', '')

await writeFile(racine + 'SCRIPT-ANTOINE.md', lignes.join('\n'))
console.log(`SCRIPT-ANTOINE.md écrit : ${PARTIES.length} parties, ${mots} mots, ~${duree}`)
