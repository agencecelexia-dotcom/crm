import type { Gravite, Perimetre, Statut } from './donnees'

/**
 * Le code couleur porte du sens, et rien d'autre :
 * bleu = périmètre Thomas · vert = périmètre Antoine ·
 * orange = en tension · rouge = critique.
 *
 * Défini en un seul endroit pour que la signification reste stable d'une
 * section à l'autre. Séparé des composants : mélanger les deux casse le
 * rafraîchissement à chaud de Vite.
 */
export const TON = {
  thomas: { bord: 'border-[#3B82F6]/40', fond: 'bg-[#3B82F6]/5', texte: 'text-[#1D4ED8]' },
  antoine: { bord: 'border-[#16A34A]/40', fond: 'bg-[#16A34A]/5', texte: 'text-[#15803D]' },
  tension: { bord: 'border-[#F59E0B]/40', fond: 'bg-[#F59E0B]/5', texte: 'text-[#B45309]' },
  critique: { bord: 'border-[#EF4444]/40', fond: 'bg-[#EF4444]/5', texte: 'text-[#B91C1C]' },
  neutre: { bord: 'border-border', fond: 'bg-card', texte: 'text-foreground' },
} as const

export const TON_ETAPE: Record<Statut, keyof typeof TON> = {
  ok: 'neutre',
  attention: 'tension',
  critique: 'critique',
}

export const TON_GRAVITE: Record<Gravite, keyof typeof TON> = {
  critique: 'critique',
  eleve: 'tension',
  moyen: 'neutre',
}

export const LIBELLE_GRAVITE: Record<Gravite, string> = {
  critique: 'Critique',
  eleve: 'Élevé',
  moyen: 'Moyen',
}

/**
 * À qui appartient une étape ou un outil.
 *
 * Le périmètre est orthogonal au statut : une étape peut être saine et relever
 * d'Antoine, ou critique et relever de Thomas. Le statut colore la carte, le
 * périmètre dit seulement qui la tient.
 */
export const LIBELLE_PERIMETRE: Record<Perimetre, string> = {
  thomas: 'Thomas',
  antoine: 'Antoine',
  equipe: 'Équipe',
  commun: 'Commun',
}

export const TON_PERIMETRE: Record<Perimetre, keyof typeof TON> = {
  thomas: 'thomas',
  antoine: 'antoine',
  equipe: 'neutre',
  commun: 'neutre',
}
