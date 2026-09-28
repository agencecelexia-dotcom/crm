// Le décodeur LAZ des fonctions Supabase : laz-perf (WebAssembly), chargé en
// mémoire une fois par instance. Réservé à Deno (spécificateur `npm:`) : les
// scripts et les tests fabriquent le leur à partir du paquet npm.

import { createLazPerf } from 'npm:laz-perf@0.0.7'
import { decompresseurLazPerf, type ModuleLazPerf } from './_copc.ts'
import { LAZ_PERF_WASM_B64 } from './_laz-wasm.ts'

export const decompresserLaz = decompresseurLazPerf(
  () =>
    createLazPerf({
      wasmBinary: Uint8Array.from(atob(LAZ_PERF_WASM_B64), (c) => c.charCodeAt(0)),
    }) as unknown as Promise<ModuleLazPerf>,
)
