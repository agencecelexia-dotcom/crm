// Le décodeur LAZ des scripts et des tests (Node) : laz-perf depuis npm, avec
// le même WebAssembly que les fonctions (qui l'embarquent via _laz-wasm.ts).

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { decompresseurLazPerf, type ModuleLazPerf } from '../supabase/functions/_copc.ts'

const require = createRequire(import.meta.url)

export const decompresserNode = decompresseurLazPerf(() => {
  const { createLazPerf } = require('laz-perf')
  return createLazPerf({ wasmBinary: readFileSync(require.resolve('laz-perf/lib/laz-perf.wasm')) }) as Promise<ModuleLazPerf>
})
