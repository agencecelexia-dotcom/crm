// Embarque le décodeur LAZ (laz-perf, WebAssembly) dans un module TypeScript,
// pour que les fonctions Supabase le chargent en mémoire (`wasmBinary`) sans
// chercher de fichier `.wasm` ni dépendre d'un CDN au démarrage.
//
//   npx jiti scripts/generer-laz-wasm.ts
//
// À relancer seulement si la version de laz-perf change (package.json).

import { readFileSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('node_modules/laz-perf/package.json', 'utf8')).version
const wasm = readFileSync('node_modules/laz-perf/lib/laz-perf.wasm')
writeFileSync(
  'supabase/functions/_laz-wasm.ts',
  `// GÉNÉRÉ par scripts/generer-laz-wasm.ts — ne pas modifier à la main.\n` +
    `// laz-perf ${version} (Apache-2.0), ${wasm.byteLength} octets de WebAssembly.\n` +
    `export const LAZ_PERF_VERSION = '${version}'\n` +
    `export const LAZ_PERF_WASM_B64 =\n  '${wasm.toString('base64')}'\n`,
)
console.log(`supabase/functions/_laz-wasm.ts : laz-perf ${version}, ${wasm.byteLength} octets`)
