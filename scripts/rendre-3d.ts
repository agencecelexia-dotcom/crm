// Dessine le modèle 3D d'une maison figée, sans navigateur applicatif ni réseau :
// pour VOIR ce que la vue 3D montrera, avant de la lancer.
//
//   npx jiti scripts/rendre-3d.ts <dossier-de-sortie> <nom> [<nom>…]
//
// Lit tests/fixtures/copc/<nom>/releve.json, en tire le modèle (`modeleDuReleve`)
// et écrit <nom>.png : la vue de dessus, puis quatre vues obliques (du sud, de
// l'est, du nord, de l'ouest). Les faces sont dessinées de la plus lointaine à
// la plus proche, remplies en aplat : un pan déchiré, un mur troué, une
// terrasse sans mur se voient tout de suite. La sortie PNG passe par le
// Chromium de Playwright, déjà là pour les tests de bout en bout.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { versLambert93 } from '../supabase/functions/_calcul-toit.ts'
import { modeleDuReleve, verifierModele, type Face3D, type Vec3 } from '../supabase/functions/_modele3d.ts'
import type { Releve } from '../supabase/functions/_releve.ts'

const PALETTE = ['#c2304a', '#2e7f9c', '#b8651b', '#3a9a54', '#7c3aed', '#c026d3', '#0e7490', '#ca8a04', '#be123c', '#4d7c0f']
const couleur = (f: Face3D): string => {
  if (f.type === 'ouverture') return '#3b82f6'
  if (f.type === 'mur') return f.mitoyen ? '#c4c4c4' : f.retrait ? '#dccdb4' : '#e8e1d5'
  return f.terrasse ? '#b8bcc4' : PALETTE[(Number(f.ref) - 1) % PALETTE.length]
}

/** Une vue orthographique : cap de la caméra (degrés, 0 = on regarde vers le nord) et hauteur (90 = du dessus). */
function vue(faces: Face3D[], cap: number, hauteur: number, l: number, h: number, titre: string): string {
  const c = (cap * Math.PI) / 180, e = (hauteur * Math.PI) / 180
  // Repère caméra : u vers la droite, v vers le haut de l'écran, p la profondeur (loin = grand).
  const proj = ([x, y, z]: Vec3): [number, number, number] => {
    const u = x * Math.cos(c) - y * Math.sin(c)
    const d = x * Math.sin(c) + y * Math.cos(c) // distance le long du regard
    return [u, d * Math.sin(e) + z * Math.cos(e), d * Math.cos(e) - z * Math.sin(e)]
  }
  const P = faces.map((f) => ({ f, q: f.sommets.map(proj) }))
  const tous = P.flatMap((p) => p.q)
  const u0 = Math.min(...tous.map((q) => q[0])), u1 = Math.max(...tous.map((q) => q[0]))
  const v0 = Math.min(...tous.map((q) => q[1])), v1 = Math.max(...tous.map((q) => q[1]))
  const k = Math.min((l - 40) / (u1 - u0 || 1), (h - 60) / (v1 - v0 || 1))
  const X = (u: number) => 20 + (u - u0) * k + (l - 40 - (u1 - u0) * k) / 2
  const Y = (v: number) => h - 20 - (v - v0) * k
  P.sort((a, b) => b.q.reduce((s, q) => s + q[2], 0) / b.q.length - a.q.reduce((s, q) => s + q[2], 0) / a.q.length)
  const corps = P.map(
    ({ f, q }) =>
      `<polygon points="${q.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="${couleur(f)}" fill-opacity="${f.terrasse ? 0.55 : 0.94}" stroke="#334155" stroke-width="0.8" stroke-linejoin="round"/>`,
  ).join('\n')
  return `<g><text x="14" y="18" font-family="sans-serif" font-size="14" fill="#0f172a">${titre}</text>${corps}</g>`
}

const COULEUR_LIGNE: Record<string, string> = { faitage: '#dc2626', aretier: '#ea580c', noue: '#2563eb', egout: '#16a34a', rive: '#7c3aed' }

/** Le plan du toit avec ses lignes (faîtage, arêtiers, noues, égouts, rives) et les sommets de chaque pan : pour voir où le contour s'écarte de la géométrie. */
function planAvecLignes(r: Releve, l: number, h: number): string {
  const [ox, oy] = r.origine
  const loc = ([lon, lat]: [number, number]): [number, number] => {
    const [x, y] = versLambert93(lon, lat)
    return [x - ox, y - oy]
  }
  const pans = r.pans.map((p) => p.contour.map(loc))
  const murs = r.murs.map(loc)
  const tous = [...pans.flat(), ...murs]
  const x0 = Math.min(...tous.map((p) => p[0])), x1 = Math.max(...tous.map((p) => p[0]))
  const y0 = Math.min(...tous.map((p) => p[1])), y1 = Math.max(...tous.map((p) => p[1]))
  const k = Math.min((l - 40) / (x1 - x0 || 1), (h - 60) / (y1 - y0 || 1))
  const X = (x: number) => (20 + (x - x0) * k).toFixed(1), Y = (y: number) => (h - 20 - (y - y0) * k).toFixed(1)
  const poly = (P: [number, number][], fill: string, stroke: string, w = 1) =>
    `<polygon points="${P.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="${fill}" fill-opacity="0.35" stroke="${stroke}" stroke-width="${w}"/>`
  return (
    `<text x="14" y="18" font-family="sans-serif" font-size="14" fill="#0f172a">plan : contours des pans (sommets) et lignes</text>` +
    poly(murs, 'none', '#111827', 1.5) +
    pans.map((P, i) => poly(P, PALETTE[i % PALETTE.length], PALETTE[i % PALETTE.length])).join('') +
    pans.map((P) => P.map((p) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="2.2" fill="#0f172a"/>`).join('')).join('') +
    r.lignes
      .map((li) => {
        const a = loc(li.a), b = loc(li.b)
        return `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="${COULEUR_LIGNE[li.type]}" stroke-width="${li.interieur ? 4 : 2.5}" stroke-dasharray="${li.interieur ? '6 3' : ''}"/>`
      })
      .join('')
  )
}

const [sortie, ...noms] = process.argv.slice(2)
if (!sortie || !noms.length) {
  console.error('usage : rendre-3d.ts <dossier-de-sortie> <nom> [<nom>…]')
  process.exit(1)
}
mkdirSync(sortie, { recursive: true })
const navigateur = await chromium.launch()
for (const nom of noms) {
  const r = JSON.parse(readFileSync(join('tests/fixtures/copc', nom, 'releve.json'), 'utf8')) as Releve
  const m = modeleDuReleve(r)
  const L = 620, H = 470
  const vues = [
    [0, 90, 'dessus'],
    [180, 38, 'depuis le sud'],
    [270, 38, "depuis l'est"],
    [0, 38, 'depuis le nord'],
    [90, 38, "depuis l'ouest"],
  ] as const
  const defauts = verifierModele(m, r)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L * 3}" height="${H * 2 + 40}" style="background:#eef2f6">` +
    `<text x="14" y="${H * 2 + 28}" font-family="sans-serif" font-size="14" fill="#7f1d1d">${nom} — ${defauts.length ? `${defauts.length} défaut(s) : ${defauts.slice(0, 6).join(' ; ').replace(/&/g, '&amp;').replace(/</g, '&lt;')}` : 'aucun défaut détecté'}</text>` +
    vues.map(([cap, haut, t], i) => `<g transform="translate(${(i % 3) * L},${Math.floor(i / 3) * H})">${vue(m.faces, cap, haut, L, H, t)}</g>`).join('') +
    `<g transform="translate(${2 * L},${H})">${planAvecLignes(r, L, H)}</g>` +
    '</svg>'
  const page = await navigateur.newPage({ viewport: { width: L * 3, height: H * 2 + 40 } })
  await page.setContent(`<body style="margin:0">${svg}</body>`)
  await page.screenshot({ path: join(sortie, `${nom}.png`) })
  await page.close()
  writeFileSync(join(sortie, `${nom}.defauts.txt`), defauts.join('\n') + '\n')
  console.log(nom, ':', defauts.length, 'défaut(s)', '→', join(sortie, `${nom}.png`))
}
await navigateur.close()
