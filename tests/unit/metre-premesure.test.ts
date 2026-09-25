import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { quantitesDeLaMaison } from '../../supabase/functions/_mesures-chantier'
import { mesurerToit, type ResultatToit } from '../../supabase/functions/_calcul-toit'
import { aire, empriseAvecDebord, facades, longueur, surfaceReelle, type Point } from '@/features/metre/geometrie'
import { mesureFacade, penteRetenue, type Toiture } from '@/features/metre/toiture'

// LA VALEUR PRÉ-MESURÉE EST CELLE QUE L'ARTISAN LIRA.
//
// La pré-mesure calcule côté serveur, sans écran ; l'écran calcule de son côté.
// Sur les toits réels figés, les deux doivent rendre les mêmes chiffres — sans
// quoi l'agence et l'artisan verraient deux surfaces pour la même maison.

const DOSSIER = fileURLToPath(new URL('../fixtures/lidar', import.meta.url))
const jeux = readdirSync(DOSSIER).map((n) => JSON.parse(readFileSync(join(DOSSIER, n, 'maison.json'), 'utf8')))

async function rejouer(j: { nom: string; contour: Point[]; grilles: Record<string, string> }): Promise<ResultatToit> {
  return mesurerToit(j.contour, async (couche) => {
    const b = readFileSync(join(DOSSIER, j.nom, j.grilles[couche]))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
}

describe.each(jeux)('pré-mesure = écran : $nom', (j) => {
  it('même toit, même façades, même hauteur', async () => {
    const t = await rejouer(j)
    const serveur = Object.fromEntries(quantitesDeLaMaison(j.contour, t).map((q) => [q.cle, q.valeur]))

    const toit = t as unknown as Toiture
    const { pente } = penteRetenue({ saisie: null, mesuree: toit, deduite: null })
    if (pente == null) {
      expect(serveur.toit_surface).toBeUndefined()
      expect(serveur.toit_pente).toBeUndefined()
    } else {
      const ecranToit = surfaceReelle(empriseAvecDebord(aire(j.contour), longueur(j.contour, true), 0.4), pente)
      expect(serveur.toit_surface).toBeCloseTo(ecranToit, 1)
      expect(serveur.toit_pente).toBe(pente)
    }

    const releves = facades(j.contour).map((f) => mesureFacade(f, toit))
    const ecranFacades = releves.length && releves.every(Boolean) ? releves.reduce((s, m) => s + m!.surface, 0) : undefined
    if (ecranFacades === undefined) expect(serveur.facades_total).toBeUndefined()
    else expect(serveur.facades_total).toBeCloseTo(ecranFacades, 1)
  })
})
