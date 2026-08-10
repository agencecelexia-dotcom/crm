/**
 * Motifs de perte normalisés (migration 0079).
 *
 * Le texte libre était inexploitable : impossible de mesurer « X % perdus sur
 * le prix » ou « Y % de doublons ». Chaque motif porte son ORIGINE, qui sépare
 * deux réalités que l'ancien libellé unique confondait :
 *   • client  → le client a dit non. Interroge la performance de l'artisan.
 *   • artisan → le lead a été refusé. Interroge la qualité des leads.
 */
export type MotifPerte =
  | 'prix_trop_eleve'
  | 'budget_insuffisant'
  | 'delai_incompatible'
  | 'signe_concurrent'
  | 'client_injoignable'
  | 'client_renonce'
  | 'hors_zone'
  | 'doublon'
  | 'hors_competence'
  | 'non_eligible_aides'
  | 'autre'

export interface MotifDef {
  cle: MotifPerte
  label: string
  origine: 'client' | 'artisan'
  /** Une relance différée a du sens sur ce motif. */
  relancable?: boolean
}

export const MOTIFS_PERTE: MotifDef[] = [
  // Le client a dit non
  { cle: 'prix_trop_eleve', label: 'Prix trop élevé', origine: 'client', relancable: true },
  { cle: 'budget_insuffisant', label: 'Budget client insuffisant', origine: 'client', relancable: true },
  { cle: 'signe_concurrent', label: 'A signé chez un concurrent', origine: 'client' },
  { cle: 'client_injoignable', label: 'Client injoignable', origine: 'client', relancable: true },
  { cle: 'client_renonce', label: 'Le client renonce à son projet', origine: 'client', relancable: true },
  { cle: 'non_eligible_aides', label: 'Non éligible aux aides', origine: 'client', relancable: true },
  // L'artisan refuse le lead
  { cle: 'hors_zone', label: 'Trop loin / hors de ma zone', origine: 'artisan' },
  { cle: 'hors_competence', label: 'Pas mon métier', origine: 'artisan' },
  { cle: 'doublon', label: 'Doublon, déjà reçu', origine: 'artisan' },
  { cle: 'delai_incompatible', label: 'Délai incompatible avec mon planning', origine: 'artisan', relancable: true },
  { cle: 'autre', label: 'Autre', origine: 'client', relancable: true },
]

export const MOTIF_LABEL: Record<string, string> = Object.fromEntries(
  MOTIFS_PERTE.map((m) => [m.cle, m.label]),
)

export function motifDef(cle: string | null | undefined): MotifDef | undefined {
  return MOTIFS_PERTE.find((m) => m.cle === cle)
}
