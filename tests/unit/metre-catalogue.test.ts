import { describe, expect, it } from 'vitest'
import { concorde, PAR_METIER, QUANTITES, quantitesDuChantier } from '@/features/metre/catalogue-metrage'
import { vueDuChantier } from '@/features/metre/vue-par-metier'
import { CLES_METRAGE } from '../../supabase/functions/_metrage'

// La même règle que `metrage_concorde` en base (0171) : un écart ici et là-bas,
// et l'agence verrait « ✓ vérifié » quand l'artisan lit « à vérifier ».

describe('concorde', () => {
  it('accepte l’arrondi du client', () => {
    expect(concorde('ml', 10, 10.5)).toBe(true) // « ma clôture fait 10 m »
    expect(concorde('m2', 100, 110)).toBe(true)
    expect(concorde('m', 1.8, 2.2)).toBe(true)
    expect(concorde('pct', 35, 38)).toBe(true)
  })
  it('signale le malentendu', () => {
    expect(concorde('ml', 10, 18.2)).toBe(false) // un autre côté du terrain
    expect(concorde('m2', 100, 140)).toBe(false)
    expect(concorde('m', 1.8, 2.5)).toBe(false)
    expect(concorde('pct', 30, 45)).toBe(false)
    expect(concorde('u', 2, 3)).toBe(false)
  })
  it('ne concorde pas avec une mesure nulle', () => {
    expect(concorde('m2', 0, 0)).toBe(false)
  })
})

describe('catalogue', () => {
  it('chaque métier ne cite que des quantités connues', () => {
    for (const cles of Object.values(PAR_METIER)) for (const c of cles) expect(QUANTITES[c]).toBeDefined()
  })
  it('les clés respectent le format de la base', () => {
    for (const c of Object.keys(QUANTITES)) expect(c).toMatch(/^[a-z_]{2,40}$/)
  })
  it('réunit les quantités de plusieurs métiers, sans doublon', () => {
    const cles = quantitesDuChantier(['Couverture', 'Toiture', 'Clôture']).map((x) => x.cle)
    expect(new Set(cles).size).toBe(cles.length)
    expect(cles).toContain('toit_surface')
    expect(cles).toContain('cloture_longueur')
  })
  it('ne propose rien pour un métier inconnu', () => {
    expect(quantitesDuChantier([null, 'Électricité'])).toEqual([])
  })
})

describe('vueDuChantier', () => {
  it('un couvreur ouvre sur son toit, un façadier sur ses murs', () => {
    expect(vueDuChantier(['Couverture'])).toBe('toit')
    expect(vueDuChantier(['Toiture', 'Couverture'])).toBe('toit')
    expect(vueDuChantier(['Façade / Ravalement'])).toBe('facades')
    expect(vueDuChantier(['Clôture'])).toBe('terrain')
  })
  it('des métiers qui ne s’accordent pas ouvrent sur tout', () => {
    expect(vueDuChantier(['Toiture', 'Façade / Ravalement'])).toBe('tout')
  })
  it('un métier inconnu, ou aucun, ouvre sur tout', () => {
    expect(vueDuChantier([])).toBe('tout')
    expect(vueDuChantier([null, 'Électricité'])).toBe('tout')
  })
})

describe('la liste de l’extraction d’appel', () => {
  it('reprend exactement les quantités et les unités du catalogue', () => {
    expect(CLES_METRAGE).toEqual(Object.fromEntries(Object.values(QUANTITES).map((q) => [q.cle, q.unite])))
  })
})
