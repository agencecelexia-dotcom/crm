import { describe, expect, it } from 'vitest'
import { formatTel } from '../../src/lib/format'

describe('lisibilité des téléphones dans les fiches et résultats de recherche', () => {
  it.each([
    ['0612345678', '06 12 34 56 78'],
    ['+33 6 12 34 56 78', '+33 6 12 34 56 78'],
    ['0033612345678', '+33 6 12 34 56 78'],
    [null, ''],
  ])('formate %s', (numero, attendu) => {
    expect(formatTel(numero)).toBe(attendu)
  })
})
