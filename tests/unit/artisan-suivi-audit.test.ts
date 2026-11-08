import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjetEspace } from '../../src/types/database'
import { ancienneteLabel, correspond, estClos, estNouveau, urgenceChantier } from '../../src/features/contrats/urgence-chantier'
import { dateLisible, dernierSuiviParlant } from '../../src/features/contrats/dernier-suivi'

const maintenant = new Date('2026-11-08T10:00:00Z')
function chantier(champs: Partial<ProjetEspace> = {}): ProjetEspace {
  return {
    id: 'audit-affectation', token: 'audit-token-fictif', statut: 'artisan_assigne',
    metier: 'Couverture', metiers: ['Couverture'], sous_metier: null,
    description: null, budget_estime: null, montant_devis: null, montant_devis_signe: null,
    commission: null, commission_encaissee: false, client_ville: 'Lyon', photos: [],
    devis_depose: false, devis_signe_depose: false, devis_url: null, devis_signe_url: null,
    issue: 'en_cours', etape: null, en_attente_depuis: null, rappel_le: null,
    recu_le: maintenant.toISOString(), derniere_activite: maintenant.toISOString(), date_rdv: null,
    non_lus: 0, client_nom: 'Émilie Démonstration', client_telephone: null, client_email: null,
    client_adresse: null, client_code_postal: '69003', suivis: [], ...champs,
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(maintenant) })
afterEach(() => vi.useRealTimers())

describe('audit suivi artisan — comportements préservés', () => {
  it.each(['gagne', 'perdu'] as const)('un dossier %s ne produit pas de relance urgente', (issue) => {
    const p = chantier({ issue, rappel_le: '2026-11-01T10:00:00Z' })
    expect(estClos(p)).toBe(true)
    expect(urgenceChantier(p)).toMatchObject({ niveau: 'aucune', groupe: 'clos' })
  })
  it('un rappel échu prime sur la réception récente', () => {
    expect(urgenceChantier(chantier({ rappel_le: '2026-11-08T09:00:00Z' }))).toMatchObject({ niveau: 'critique', raison: 'Rappel à passer' })
  })
  it('un RDV passé à l’étape RDV demande une mise à jour', () => {
    expect(urgenceChantier(chantier({ etape: 'rdv_pris', statut: 'rdv_pris', date_rdv: '2026-11-07T15:00:00Z' }))).toMatchObject({ niveau: 'critique', groupe: 'rdv' })
  })
  it('une étape postérieure au RDV ne porte plus l’alerte RDV passé', () => {
    expect(urgenceChantier(chantier({ etape: 'devis_envoye', statut: 'devis_envoye', date_rdv: '2026-11-07T15:00:00Z' })).raison).not.toBe('RDV passé, à mettre à jour')
  })
  it('la recherche retrouve aussi le code postal', () => {
    expect(correspond(chantier(), '69003')).toBe(true)
    expect(correspond(chantier(), 'introuvable')).toBe(false)
  })
  it('le dernier texte utile ne disparaît pas derrière un changement de statut sans message', () => {
    const note = { auteur: 'artisan' as const, type: 'note' as const, statut: null, message: 'Le client rappelle lundi', created_at: '2026-11-07T12:00:00Z' }
    expect(dernierSuiviParlant(chantier({ suivis: [note, { ...note, type: 'statut', statut: 'contacte', message: null, created_at: '2026-11-08T09:00:00Z' }] }))).toEqual(note)
  })
})

describe('audit suivi artisan — anomalies connues avant correction', () => {
  it('SUIVI-10 : le badge Nouveau expire à 48 h, comme la règle d’urgence', () => {
    const p = chantier({ recu_le: '2026-11-06T09:00:00Z' }) // 49 h
    expect(urgenceChantier(p).raison).toBe('Jamais contacté (2 j)')
    expect(estNouveau(p)).toBe(false)
  })
  it('SUIVI-11 : un rappel futur est visible sur un devis ancien sans être présenté comme urgent', () => {
    const p = chantier({ statut: 'devis_envoye', etape: 'devis_envoye', recu_le: '2026-10-01T10:00:00Z', derniere_activite: '2026-10-01T10:00:00Z', rappel_le: '2026-11-15T10:00:00Z' })
    expect(urgenceChantier(p)).toMatchObject({ niveau: 'normale', raison: 'Rappel programmé' })
  })
  it('SUIVI-12 : hier reste hier même si moins de 24 h se sont écoulées', () => {
    expect(ancienneteLabel('2026-11-07T22:00:00Z')).toBe('hier')
    expect(dateLisible('2026-11-07T22:00:00Z')).toMatch(/^hier à /)
  })
  it('SUIVI-13 : une date de réception invalide ne produit pas « NaN mois »', () => {
    expect(ancienneteLabel('date-invalide')).toBeNull()
  })
  it('SUIVI-14 : la recherche d’un nom fonctionne sans saisir son accent', () => {
    expect(correspond(chantier(), 'emilie')).toBe(true)
  })
})
