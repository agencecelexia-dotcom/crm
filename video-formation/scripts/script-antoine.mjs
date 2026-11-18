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

// ——— Version page (téléprompteur léger), publiée pour Antoine ———
const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ecran = (t) => echapper(t).replace(/«\s?([^»]+?)\s?»/g, '«&nbsp;<span class="ecran">$1</span>&nbsp;»')
const cartes = PARTIES.map((p, i) => `
    <section class="partie" id="partie-${i + 1}">
      <header class="partie-tete">
        <span class="num">Vidéo ${i + 1} / ${PARTIES.length}</span>
        <label class="fait"><input type="checkbox" id="fait-${p.id}" data-id="${p.id}"> Filmée</label>
      </header>
      <h2>${echapper(p.titre)}</h2>
      <div class="texte">${p.texte.map((t) => `<p>${ecran(t)}</p>`).join('')}</div>
    </section>`).join('')

const html = `<title>Tournage espace artisan</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>
  /* Une colonne de lecture, gros caractères : se lit posé à côté de la caméra. */
  :root {
    --fond: #f7f8fa; --carte: #ffffff; --texte: #20232b; --doux: #5d6170; --trait: #e3e4ec;
    --violet: #6d4bd1; --violet-pale: #efeafc; --vert: #15803d; --vert-pale: #e8f6ee;
    --police: "Plus Jakarta Sans", system-ui, -apple-system, sans-serif;
    --taille: 22px;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --fond: #16161c; --carte: #202027; --texte: #ededf1; --doux: #a5a5af; --trait: #33333d;
    --violet: #b6a1f0; --violet-pale: #2c2546; --vert: #6fd39a; --vert-pale: #1d3328; color-scheme: dark } }
  :root[data-theme="dark"] {
    --fond: #16161c; --carte: #202027; --texte: #ededf1; --doux: #a5a5af; --trait: #33333d;
    --violet: #b6a1f0; --violet-pale: #2c2546; --vert: #6fd39a; --vert-pale: #1d3328; color-scheme: dark }
  body { background: var(--fond); color: var(--texte); font-family: var(--police); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 64px; }
  body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--fond); }
  .page { max-width: 720px; margin: 0 auto; display: grid; gap: 20px; }
  .barre { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding-block: 12px; background: var(--fond); border-bottom: 1px solid var(--trait); }
  .progres { font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; }
  .progres span { color: var(--violet); }
  .outils { display: flex; gap: 6px; }
  .outils button { font: 600 15px var(--police); min-width: 44px; min-height: 40px; border-radius: 10px; border: 1px solid var(--trait); background: var(--carte); color: var(--texte); cursor: pointer; }
  .outils button:focus-visible, .fait input:focus-visible { outline: 3px solid var(--violet); outline-offset: 2px; }
  .intro { padding-top: 12px; }
  .surtitre { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--violet); }
  h1 { margin: 6px 0 0; font-size: clamp(30px, 6vw, 40px); line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance; }
  .chapo { margin: 10px 0 0; color: var(--doux); font-size: 17px; line-height: 1.55; }
  .consignes { background: var(--carte); border: 1px solid var(--trait); border-radius: 16px; padding: 18px 20px; }
  .consignes h2 { margin: 0 0 8px; font-size: 18px; }
  .consignes ul { margin: 0; padding-left: 20px; display: grid; gap: 8px; font-size: 16px; line-height: 1.5; }
  .partie { background: var(--carte); border: 1px solid var(--trait); border-radius: 16px; padding: 18px 20px 6px; scroll-margin-top: 80px; }
  .partie.filmee { border-color: var(--vert); }
  .partie-tete { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .num { font-size: 13px; font-weight: 700; color: var(--violet); background: var(--violet-pale); border-radius: 999px; padding: 4px 10px; font-variant-numeric: tabular-nums; }
  .fait { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-size: 15px; font-weight: 600; color: var(--doux); cursor: pointer; }
  .fait input { width: 22px; height: 22px; accent-color: var(--vert); }
  .partie.filmee .fait { color: var(--vert); }
  .partie h2 { margin: 10px 0 4px; font-size: 19px; color: var(--doux); font-weight: 600; }
  .texte p { margin: 0 0 14px; font-size: var(--taille); line-height: 1.6; font-weight: 500; }
  .ecran { color: var(--violet); font-weight: 700; }
  .legende { font-size: 14px; color: var(--doux); }
  .fin { text-align: center; color: var(--doux); font-size: 16px; }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>
<div class="page">
  <div class="barre" role="toolbar" aria-label="Lecture">
    <p class="progres" id="progres" aria-live="polite"><span>0</span> / ${PARTIES.length} vidéos filmées</p>
    <div class="outils">
      <button type="button" id="moins" aria-label="Texte plus petit">A−</button>
      <button type="button" id="plus" aria-label="Texte plus grand">A+</button>
    </div>
  </div>
  <div class="intro">
    <p class="surtitre">Vidéo « Votre espace artisan »</p>
    <h1>Le texte à lire face caméra</h1>
    <p class="chapo">${mots} mots, environ ${duree} au total. Les artisans verront cette vidéo à leur première connexion. Ta voix guide l’écran : chaque bouton s’allume quand tu le nommes.</p>
  </div>
  <div class="consignes">
    <h2>Avant de tourner</h2>
    <ul>
      <li><b>Une petite vidéo par partie</b> : ${PARTIES.length} vidéos, dans l’ordre. Une erreur ? Refilme la partie <b>tout de suite</b>, avant la suivante, et supprime la ratée.</li>
      <li>Dans chaque vidéo : lance, <b>attends 1 seconde</b>, parle, <b>attends 1 seconde</b>, coupe.</li>
      <li>Téléphone <b>à la verticale</b>, posé à hauteur des yeux, au même endroit pour toutes les vidéos. Visage centré avec de la marge : il sera découpé en rond.</li>
      <li>Lumière douce de face (une fenêtre), fond simple, pièce calme. Un micro-cravate si tu en as un.</li>
      <li>Regarde l’objectif, souris, parle comme au téléphone avec un artisan. Lis tranquillement, phrase par phrase.</li>
      <li>Les mots <span class="ecran">en violet</span> sont écrits tels quels sur l’écran de l’artisan : dis-les exactement.</li>
      <li>Envoie les vidéos <b>originales</b> (AirDrop, WeTransfer, Google Drive), <b>pas par WhatsApp</b>.</li>
    </ul>
  </div>${cartes}
  <p class="fin">Dernière vidéo : garde 2 secondes de sourire avant de couper. Merci Antoine !</p>
</div>
<script>
  (() => {
    const lire = (c, d) => { try { return JSON.parse(localStorage.getItem(c)) ?? d } catch { return d } }
    const ecrire = (c, v) => { try { localStorage.setItem(c, JSON.stringify(v)) } catch {} }
    const faites = new Set(lire('tournage-faites', []))
    const cases = [...document.querySelectorAll('.fait input')]
    const maj = () => {
      cases.forEach((c) => { c.checked = faites.has(c.dataset.id); c.closest('.partie').classList.toggle('filmee', c.checked) })
      document.querySelector('#progres span').textContent = faites.size
    }
    cases.forEach((c) => c.addEventListener('change', () => {
      c.checked ? faites.add(c.dataset.id) : faites.delete(c.dataset.id)
      ecrire('tournage-faites', [...faites]); maj()
      if (c.checked) { const suite = c.closest('.partie').nextElementSibling; if (suite?.classList.contains('partie')) suite.scrollIntoView({ block: 'start' }) }
    }))
    let taille = lire('tournage-taille', 22)
    const appliquer = () => { document.documentElement.style.setProperty('--taille', taille + 'px'); ecrire('tournage-taille', taille) }
    document.getElementById('moins').onclick = () => { taille = Math.max(16, taille - 2); appliquer() }
    document.getElementById('plus').onclick = () => { taille = Math.min(40, taille + 2); appliquer() }
    appliquer(); maj()
  })()
</script>
`
const { mkdir: creerDossier } = await import('node:fs/promises')
await creerDossier(racine + 'out', { recursive: true })
await writeFile(racine + 'out/script-antoine.html', html)
console.log('out/script-antoine.html écrit (page pour Antoine)')
