// Génère le seed SQL des zones de couverture = communes >= SEUIL habitants (hors DOM),
// depuis l'API publique geo.api.gouv.fr. One-time / regénérable.
//   node scripts/generer-zones.mjs [seuil]   (défaut 25000)
// → écrit supabase/migrations/0047_zones_seed.sql (INSERT … ON CONFLICT, idempotent).
import { writeFileSync } from 'node:fs'

const SEUIL = Number(process.argv[2] || 25000)
const URL =
  'https://geo.api.gouv.fr/communes?fields=nom,code,population,centre,codeDepartement,codeRegion&format=json&geometry=centre'

const res = await fetch(URL)
if (!res.ok) {
  console.error('Erreur geo.api.gouv.fr :', res.status)
  process.exit(1)
}
const communes = await res.json()
const esc = (s) => String(s ?? '').replace(/'/g, "''")

const rows = communes
  .filter((c) => (c.population || 0) >= SEUIL)
  // Hors DOM-TOM (départements 97x/98x)
  .filter((c) => {
    const d = String(c.codeDepartement || '')
    return !d.startsWith('97') && !d.startsWith('98')
  })
  .filter((c) => c.centre && Array.isArray(c.centre.coordinates))
  .sort((a, b) => (b.population || 0) - (a.population || 0))

const values = rows
  .map((c) => {
    const [lon, lat] = c.centre.coordinates
    return `  ('${c.code}', '${esc(c.nom)}', ${lat}, ${lon}, '${esc(c.codeDepartement)}', '${esc(c.codeRegion)}', ${c.population || 0})`
  })
  .join(',\n')

const sql = `-- 0047 — Seed des zones de couverture (communes >= ${SEUIL} hab, hors DOM).
-- GÉNÉRÉ par scripts/generer-zones.mjs — ne pas éditer à la main. ${rows.length} zones.
insert into public.zones (id, nom, lat, lon, departement, region, population) values
${values}
on conflict (id) do update set
  nom = excluded.nom, lat = excluded.lat, lon = excluded.lon,
  departement = excluded.departement, region = excluded.region, population = excluded.population;
`

writeFileSync('supabase/migrations/0047_zones_seed.sql', sql)
console.error(`Zones >= ${SEUIL} hab : ${rows.length} — écrit dans supabase/migrations/0047_zones_seed.sql`)
