// Le banc d'essai du métré par IA : lance la lecture sur les maisons de l'audit
// du 29/09/2026 (par le serveur, qui a le réseau IGN) et compare ce qui en sort
// aux références de l'audit — hauteurs, pentes, surfaces — puis dit ce que l'IA
// a compris. Ne touche aucun dossier de chantier : il ne lit que par bâtiment.
//
//   npx jiti scripts/banc-ia.ts [--relire] [<nom> …]
//
// Il faut `.env.secrets.local` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Écrit
// un rapport Markdown sur la sortie standard (à rediriger dans un fichier).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { toitRetenu, pansParDefaut } from '../supabase/functions/_releve-retenu.ts'
import type { Releve } from '../supabase/functions/_releve.ts'
import type { SceneIA, VerifScene } from '../supabase/functions/_scene-ia.ts'

const env = Object.fromEntries(
  readFileSync('.env.secrets.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
)
const URL_BASE = env.SUPABASE_URL, CLE = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !CLE) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env.secrets.local')

interface Reference {
  nom: string
  cleabs: string
  adresse: string
  /** Pente des pans (médiane R-MNS de l'audit), en %. */
  pente: number
  /** Faîtage (BD TOPO altitude max − MNT médian). */
  faitage: number
  /** Gouttière : les deux références de l'audit (altitude min du toit − MNT médian ; `hauteur` BD TOPO). */
  gouttiere: [number, number]
}

const REFERENCES: Reference[] = [
  { nom: 'nogent27bis', cleabs: 'BATIMENT0000000243500323', adresse: '27 bis rue François Rolland, Nogent-sur-Marne', pente: 57, faitage: 8.92, gouttiere: [7.22, 9.5] },
  { nom: 'oullins', cleabs: 'BATIMENT0000000242610441', adresse: '3 chemin des Mûriers, Oullins-Pierre-Bénite', pente: 30, faitage: 12.27, gouttiere: [10.3, 11.47] },
  { nom: 'sathonay', cleabs: 'BATIMENT0000002209748162', adresse: '1 allée des Sapins, Sathonay-Camp', pente: 36, faitage: 7.57, gouttiere: [6.37, 6.8] },
  { nom: 'oucques1b', cleabs: 'BATIMENT0000000321387085', adresse: '1b avenue Clémentine Martin, Oucques', pente: 73, faitage: 8.77, gouttiere: [4.87, 5.8] },
  { nom: 'oucques6', cleabs: 'BATIMENT0000000321387088', adresse: '6 rue Henry Berthelemy, Oucques', pente: 81, faitage: 8.02, gouttiere: [4.12, 5.2] },
  { nom: 'nogent44', cleabs: 'BATIMENT0000000243500516', adresse: '44 rue François Rolland, Nogent-sur-Marne', pente: 49, faitage: 9.9, gouttiere: [7.0, 7.9] },
]

const relire = process.argv.includes('--relire')
const noms = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const choisies = noms.length ? REFERENCES.filter((r) => noms.includes(r.nom)) : REFERENCES

/** Le centre de la maison, lu dans sa fixture : un point d'appui qui évite au serveur le filtre lent de l'IGN (22 s). */
function pointDe(nom: string): [number, number] | null {
  const fichier = `tests/fixtures/copc/${{ nogent27bis: 'terrasse', sathonay: 'deux-pans-simple' }[nom] ?? nom}/maison.json`
  if (!existsSync(fichier)) return null
  const { contour } = JSON.parse(readFileSync(fichier, 'utf8')) as { contour: [number, number][] }
  return [contour.reduce((s, p) => s + p[0], 0) / contour.length, contour.reduce((s, p) => s + p[1], 0) / contour.length]
}

/** Un fetch qui réessaie : la connexion se coupe parfois en plein banc (un banc dure dix minutes). */
async function avecReessais(url: string, init: RequestInit, essais = 5): Promise<Response> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await fetch(url, init)
    } catch (e) {
      derniere = e
      await new Promise((ok) => setTimeout(ok, 3000 * (i + 1)))
    }
  }
  throw derniere
}

async function fonction(corps: Record<string, unknown>) {
  const r = await avecReessais(`${URL_BASE}/functions/v1/metre-ia`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CLE}` },
    body: JSON.stringify({ token: 'banc', ...corps }),
  })
  return (await r.json()) as { ok?: boolean; error?: string; statut?: string; scene?: SceneIA; verif?: VerifScene; motif?: string; cout?: Record<string, number>; modele?: string; etapes?: { cle: string; ms: number }[] }
}

/** La ligne gardée par maison : scène, tracés, mesures, coût. Écrite en JSON si `BANC_DIR` est posé. */
async function ligneDe(nom: string, cleabs: string) {
  const r = await avecReessais(`${URL_BASE}/rest/v1/metre_ia?cleabs=eq.${cleabs}&select=*`, { headers: { apikey: CLE, authorization: `Bearer ${CLE}` } })
  const [l] = (await r.json()) as Record<string, unknown>[]
  if (l && process.env.BANC_DIR) {
    mkdirSync(process.env.BANC_DIR, { recursive: true })
    writeFileSync(`${process.env.BANC_DIR}/${nom}.json`, JSON.stringify(l, null, 1))
  }
  return l as { traces?: { id: number; genre: string; note: string }[]; mesures?: { id: number; genre: string; mesure: Record<string, unknown>; alertes: string[] }[]; cout?: Record<string, unknown> } | undefined
}

async function releveDe(cleabs: string): Promise<Releve | null> {
  const r = await avecReessais(`${URL_BASE}/rest/v1/releve_batiment?cleabs=eq.${cleabs}&select=releve`, { headers: { apikey: CLE, authorization: `Bearer ${CLE}` } })
  const [l] = (await r.json()) as { releve: Releve | null }[]
  return l?.releve ?? null
}

const m = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2).replace('.', ','))
const ecart = (v: number | null | undefined, ref: number) => (v == null ? '—' : `${v - ref >= 0 ? '+' : ''}${(v - ref).toFixed(2).replace('.', ',')}`)

console.log(`# Banc du métré par IA — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`)
console.log('| Maison | Statut | Durée | Jetons (entrée/sortie) | Gouttière | Réf. gouttière | Faîtage | Écart faîtage | Pente des pans | Écart pente |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
const details: string[] = []
for (const ref of choisies) {
  let etat = await fonction({ cleabs: ref.cleabs, action: 'lire', relire, point: pointDe(ref.nom) })
  for (let i = 0; i < 100 && etat.statut === 'en_cours'; i++) {
    await new Promise((ok) => setTimeout(ok, 5000))
    etat = await fonction({ cleabs: ref.cleabs, action: 'etat' })
  }
  const r = etat.statut === 'fait' ? await releveDe(ref.cleabs) : null
  const t = r ? toitRetenu(r, pansParDefaut(r)) : null
  const g = r?.hauteurs.gouttiere
  const dans = g != null && g > Math.min(...ref.gouttiere) - 0.8 && g < Math.max(...ref.gouttiere) + 0.3
  console.log(
    `| ${ref.nom} | ${etat.statut ?? etat.error} ${etat.motif ?? ''} | ${etat.cout?.duree_ms ? Math.round(etat.cout.duree_ms / 1000) + ' s' : '—'} | ${etat.cout ? `${etat.cout.entree}/${etat.cout.sortie}` : '—'} | ${m(g)} ${g != null ? (dans ? '✅' : '❌') : ''} | ${ref.gouttiere.map(m).join(' – ')} | ${m(r?.hauteurs.faitage)} | ${ecart(r?.hauteurs.faitage, ref.faitage)} | ${t ? t.penteDesPans + ' %' : '—'} | ${t ? ecart(t.penteDesPans, ref.pente) : '—'} |`,
  )
  const ligne = etat.statut === 'fait' ? await ligneDe(ref.nom, ref.cleabs) : undefined
  if (ligne?.traces) {
    details.push(`## Tracés de l'IA — ${ref.nom}\n`)
    const somme = (ligne.mesures ?? []).filter((m) => m.genre === 'pan').reduce((s, m) => s + (typeof m.mesure.aire_vraie_m2 === 'number' ? m.mesure.aire_vraie_m2 : 0), 0)
    const auto = (await releveDe(ref.cleabs))?.surfaces.toitVrai
    details.push(`Somme des pans tracés : ${somme.toFixed(1)} m² (relevé automatique : ${auto ?? '—'} m², terrasses comprises)\n`)
    details.push(`Tours : ${ligne.cout?.tours_traces ?? '?'} · jetons (tracés) ${ligne.cout?.entree_traces ?? '?'}/${ligne.cout?.sortie_traces ?? '?'} · ${ligne.cout?.resume_traces ?? ''}\n`)
    for (const m of ligne.mesures ?? []) {
      const n = ligne.traces.find((t) => t.id === m.id)?.note ?? ''
      details.push(`- **${m.genre} ${m.id}** ${Object.entries(m.mesure).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join(', ')}${m.alertes.length ? ` ⚠ ${m.alertes.join(' | ')}` : ''} — ${n}`)
    }
    details.push('')
  }
  if (etat.scene) {
    details.push(`## ${ref.nom} — ${ref.adresse}\n`)
    details.push(`Modèle ${etat.modele} · emprise « ${etat.scene.emprise} » · mitoyenne ${etat.scene.mitoyenne ? 'oui' : 'non'} · confiance ${etat.scene.confiance}\n`)
    for (const v of etat.scene.volumes) details.push(`- **${v.genre}** (niveau ${v.niveau ?? '—'}, pans ${v.pans.join(', ') || '—'}, ${v.confiance}) : ${v.remarque}`)
    if (etat.scene.escaliers.length) details.push(`- Escaliers : ${etat.scene.escaliers.map((e) => `transition ${e.transition}`).join(', ')}`)
    if (etat.verif?.corrections.length) details.push(`\nCorrigé par les mesures :\n${etat.verif.corrections.map((c) => `- ${c}`).join('\n')}`)
    if (etat.verif?.a_verifier.length) details.push(`\nÀ vérifier :\n${etat.verif.a_verifier.map((c) => `- ${c}`).join('\n')}`)
    details.push('')
  }
}
console.log('\n' + details.join('\n'))
