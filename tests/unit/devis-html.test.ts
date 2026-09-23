import { describe, expect, it } from 'vitest'
import { devisEnHtml, objetCourriel } from '../../src/features/devis/devis-html'
import type { DevisData } from '../../src/features/devis/devis-pdf'

const base: DevisData = {
  numero: 'DEV-2026-0042',
  date: '2026-09-23T10:00:00.000Z',
  dateValidite: '2026-10-23',
  vendeur: { nom: 'METBACH RÉNOVATION', ville: 'Publier', cp: '74500', siren: '448464545' },
  client: { nom: 'Mme Durand', ville: 'Thonon', cp: '74200' },
  objet: 'Ravalement de façade',
  lignes: [
    { designation: 'Enduit traditionnel', quantite: 120, unite: 'm²', prix_unitaire: 60, tva_taux: 10 },
    { designation: 'Échafaudage', quantite: 1, unite: 'forfait', prix_unitaire: 1000, tva_taux: 20 },
  ],
  total: 9120,
  totalHt: 8200,
  totalTva: 920,
  tvaMode: 'normal',
  acomptePct: 30,
}

describe('devisEnHtml — le devis tel que le client le reçoit', () => {
  it('ventile la TVA par taux', () => {
    const html = devisEnHtml(base)
    // 7 200 € à 10 % = 720 €, 1 000 € à 20 % = 200 €.
    expect(html).toContain('TVA 10&nbsp;% sur')
    expect(html).toContain('TVA 20&nbsp;% sur')
    expect(html).toContain('720,00&nbsp;€')
    expect(html).toContain('200,00&nbsp;€')
  })

  it('porte le total, l’acompte et le solde', () => {
    const html = devisEnHtml(base)
    expect(html).toContain('9&nbsp;120,00&nbsp;€')
    expect(html).toContain('2&nbsp;736,00&nbsp;€') // acompte 30 %
    expect(html).toContain('6&nbsp;384,00&nbsp;€') // solde
  })

  it('affiche la mention de franchise au lieu de la TVA', () => {
    const html = devisEnHtml({ ...base, tvaMode: 'franchise' })
    expect(html).toContain('293&nbsp;B')
    expect(html).toContain('Net à payer')
    expect(html).not.toContain('Total HT')
  })

  it('échappe tout ce qui vient de l’artisan ou du client', () => {
    const html = devisEnHtml({
      ...base,
      client: { nom: '<script>alert(1)</script>' },
      lignes: [{ designation: 'Pose "spéciale" & finitions <b>', quantite: 1, unite: 'u', prix_unitaire: 10 }],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('n’affiche pas de bloc client quand il n’y en a pas', () => {
    expect(devisEnHtml({ ...base, client: {} })).not.toContain('>Client<')
  })

  it('reste sans logo quand l’entreprise n’en a pas', () => {
    expect(devisEnHtml(base)).not.toContain('<img')
    expect(devisEnHtml({ ...base, vendeur: { ...base.vendeur, logoUrl: 'https://x/l.png' } }))
      .toContain('<img src="https://x/l.png"')
  })
})

describe('objetCourriel — ce que le client lit avant d’ouvrir', () => {
  it('porte le numéro, l’objet et le montant', () => {
    expect(objetCourriel(base)).toBe('Votre devis DEV-2026-0042 — Ravalement de façade — 9 120 €')
  })

  it('se rabat sur « travaux » sans objet', () => {
    expect(objetCourriel({ ...base, objet: null })).toContain('travaux')
  })
})
