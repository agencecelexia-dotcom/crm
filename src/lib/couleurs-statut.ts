/** Même vocabulaire visuel côté agence et artisan. Les libellés restent
 * indispensables : la couleur accompagne l'information, elle ne la remplace pas.
 * Texte sombre sur fond clair : contraste AA, y compris orange/jaune. */
export const PALETTE_STATUTS = {
  bleu: { fond: '#DBEAFE', texte: '#1E40AF', bordure: '#93C5FD', accent: '#2563EB' },
  ciel: { fond: '#E0F2FE', texte: '#075985', bordure: '#7DD3FC', accent: '#0284C7' },
  violet: { fond: '#EDE9FE', texte: '#5B21B6', bordure: '#C4B5FD', accent: '#7C3AED' },
  orange: { fond: '#FFEDD5', texte: '#9A3412', bordure: '#FDBA74', accent: '#EA580C' },
  ambre: { fond: '#FEF3C7', texte: '#92400E', bordure: '#FCD34D', accent: '#D97706' },
  vert: { fond: '#DCFCE7', texte: '#166534', bordure: '#86EFAC', accent: '#16A34A' },
  sarcelle: { fond: '#CCFBF1', texte: '#115E59', bordure: '#5EEAD4', accent: '#0D9488' },
  rouge: { fond: '#FEE2E2', texte: '#991B1B', bordure: '#FCA5A5', accent: '#DC2626' },
  rose: { fond: '#FCE7F3', texte: '#9D174D', bordure: '#F9A8D4', accent: '#DB2777' },
  gris: { fond: '#F1F5F9', texte: '#334155', bordure: '#CBD5E1', accent: '#64748B' },
} as const

const FAMILLE: Record<string, keyof typeof PALETTE_STATUTS> = {
  nouveau: 'bleu', artisan_assigne: 'bleu', a_faire: 'bleu', contacte: 'ciel',
  a_rappeler: 'orange', en_attente: 'ambre', rdv_pris: 'violet',
  devis_envoye: 'ambre', devis_signe: 'vert', termine: 'sarcelle',
  perdu: 'rouge', a_reattribuer: 'rose', mort: 'gris',
  artisan_demarche: 'sarcelle', demarchage: 'gris', masque: 'gris',
}
export function couleurStatut(statut: string | null | undefined) {
  return PALETTE_STATUTS[FAMILLE[statut ?? ''] ?? 'gris']
}
export function styleStatut(statut: string | null | undefined) {
  const c = couleurStatut(statut)
  return { backgroundColor: c.fond, color: c.texte, borderColor: c.bordure }
}
