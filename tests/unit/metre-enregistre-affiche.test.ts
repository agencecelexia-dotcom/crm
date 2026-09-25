import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { aire, distance, empriseAvecDebord, facades, longueur, surfaceReelle, type Point } from '@/features/metre/geometrie'

// ENREGISTRÉ = AFFICHÉ.
//
// L'écran calcule une surface ; à l'enregistrement, la base la RECALCULE avec
// ses propres fonctions (aire_polygone, longueur_ligne, longueur_pans). Si les
// deux formules divergent, l'artisan lit un chiffre et l'agence en reçoit un
// autre. Les valeurs de référence sont celles que la base a rendues pour les
// contours des jeux d'essai ; `supabase/tests/metre_enregistre_affiche.sql`
// vérifie la base contre les mêmes.

const lire = (chemin: string) => JSON.parse(readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8'))
const reference = lire('../fixtures/metre-reference-sql.json') as {
  mesures: { maison: string; aire: number; perimetre: number; longueur_pans: number }[]
}

/** À 0,05 % près : la base arrondit au centimètre carré. */
const proche = (ecran: number, base: number) => expect(Math.abs(ecran - base) / base).toBeLessThan(0.0005)

describe.each(reference.mesures)('$maison', (r) => {
  const contour = lire(`../fixtures/lidar/${r.maison}/maison.json`).contour as Point[]

  it('même emprise et même périmètre que la base', () => {
    proche(aire(contour), r.aire)
    proche(longueur(contour, true), r.perimetre)
  })

  it('même longueur de façade que la base', () => {
    const pans = facades(contour).flatMap((f) => f.pans)
    proche(pans.reduce((s, p) => s + distance(p.a, p.b), 0), r.longueur_pans)
  })

  it('même surface de toit, débord et pente compris', () => {
    // Formule de la base : (aire + périmètre × débord + π débord²) / cos(atan(pente)).
    const base = (r.aire + r.perimetre * 0.4 + Math.PI * 0.16) / Math.cos(Math.atan(0.36))
    proche(surfaceReelle(empriseAvecDebord(aire(contour), longueur(contour, true), 0.4), 36), base)
  })
})
