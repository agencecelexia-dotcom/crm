import { describe, expect, it } from 'vitest'
import { emailInvitation, lienInscription, validerInvitation } from '../../supabase/functions/_invitation-artisan'
import { PALETTE_STATUTS } from '../../src/lib/couleurs-statut'

const TOKEN = 'a'.repeat(64) // Jeton fictif, aucun lien réel.

describe('invitation Celexia', () => {
  it.each([10, 15, 20])('affiche le taux %i dans le message, sans le révéler dans le lien', (taux) => {
    const p = validerInvitation({ email: '  test@example.test ', taux })
    const mail = emailInvitation(p, TOKEN)
    expect(mail.lien).toBe(`https://crm-ci7k.vercel.app/rejoindre/${TOKEN}`)
    expect(lienInscription('https://crm.example/', TOKEN)).toBe(`https://crm.example/rejoindre/${TOKEN}`)
    expect(mail.html).toContain(`${taux} %`)
    expect(mail.html).toContain('/logo.png')
    expect(new URL(mail.lien).search).toBe('')
    expect(mail.lien).not.toContain('taux')
  })
  it.each([
    [{}, 'Bonjour,'], [{ nom: 'Durand' }, 'Bonjour Durand,'],
    [{ prenom: 'Sam' }, 'Bonjour Sam,'], [{ prenom: 'Sam', nom: 'Durand' }, 'Bonjour Sam Durand,'],
    [{ societe: 'Atelier Durand' }, 'Bonjour à l’équipe Atelier Durand,'],
  ])('adapte la salutation sans information inventée', (partiel, attendu) => {
    expect(emailInvitation(validerInvitation({ email: 'test@example.test', taux: 15, ...partiel }), TOKEN).bonjour).toBe(attendu)
  })
  it('échappe les champs et refuse les entêtes injectés', () => {
    const html = emailInvitation(validerInvitation({ email: 'test@example.test', taux: 15, nom: '<img src=x onerror=alert(1)>' }), TOKEN).html
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(() => validerInvitation({ email: 'test@example.test\r\nBcc: other@example.test', taux: 15 })).toThrow()
    expect(() => validerInvitation({ email: 'test@example.test', taux: 15, nom: 'a'.repeat(101) })).toThrow()
  })
  it.each(['', 'email?taux=10', '15', 'a'.repeat(63), 'g'.repeat(64)])('refuse un lien sans jeton valide : %s', (token) => {
    expect(() => lienInscription('https://crm.example', token)).toThrow()
  })
  it.each([0, 5, 30, '15', null])('refuse un taux non proposé : %s', (taux) => {
    expect(() => validerInvitation({ email: 'test@example.test', taux })).toThrow()
  })
})

describe('lisibilité des couleurs communes', () => {
  const luminance = (hex: string) => {
    const c = hex.match(/[a-f0-9]{2}/gi)!.map((v) => parseInt(v, 16) / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
  }
  it.each(Object.entries(PALETTE_STATUTS))('texte %s : contraste AA sur le fond du badge', (_, c) => {
    expect((luminance(c.fond) + .05) / (luminance(c.texte) + .05)).toBeGreaterThanOrEqual(4.5)
  })
})
