import { describe, expect, it } from 'vitest'
import { texteMetre, type ResumeMetre } from '@/features/metre/resume-metre'

const base: ResumeMetre = {
  titre: 'Mme Conus',
  adresse: '1 Allée des Sapins, 69580 Sathonay-Camp',
  toit: { surface: 101.66, pente: 36, pans: 'deux pans à 36 %', debordCm: 40, source: 'lidar', versant: null },
  facades: [{ orientation: 'sud', surface: 34.2, hauteur: 6.1 }],
  emprise: 80.12,
  perimetre: 37.56,
  dimensions: { longueur: 12.3, largeur: 6.59 },
}

describe('texteMetre', () => {
  it('donne chaque chiffre avec sa provenance', () => {
    const t = texteMetre(base)
    expect(t).toContain('Toit : 102 m² — deux pans à 36 %, débord 40 cm — mesuré au LiDAR de l’IGN')
    expect(t).toContain('Façade sud : 34 m²')
    expect(t).toContain('ouvertures non déduites')
    expect(t).toContain('à confirmer sur place')
  })
  it('donne ce qu’il faut commander, chutes comprises', () => {
    expect(texteMetre(base)).toMatch(/À commander : 107 m² \(\+5 %\) · 112 m² \(\+10 %\) · 117 m² \(\+15 %\)/)
  })
  it('sans toit mesuré, ne l’invente pas', () => {
    const t = texteMetre({ ...base, toit: null })
    expect(t).not.toContain('Toit')
    expect(t).toContain('Au sol : 80 m²')
  })
  it('sans adresse (contrat non signé), ne l’écrit pas', () => {
    expect(texteMetre({ ...base, adresse: null })).not.toContain('Sathonay')
  })
})
