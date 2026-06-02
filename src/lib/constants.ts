import type { StatutProjet } from '@/types/database'

// ------------------------------------------------------------
//  Constantes métier partagées dans toute l'app
// ------------------------------------------------------------

/** Liste des métiers proposés (saisie rapide + filtres). */
export const METIERS = [
  'Clôture',
  'Piscine',
  'Paysagisme',
  'CVC', // Chauffage Ventilation Climatisation
  'Couverture',
  'Maçonnerie',
  'Menuiserie',
  'Électricité',
  'Plomberie',
  'Terrasse',
  'Portail',
  'Toiture',
  'Isolation',
  'Rénovation',
] as const

/**
 * Configuration des statuts : libellé FR + couleur sémantique (hex).
 * Utilisée pour les badges et les pins de la carte (couleurs exactes de la spec).
 */
export const STATUTS: Record<
  StatutProjet,
  { label: string; color: string; textOnColor: string }
> = {
  nouveau: { label: 'Nouveau', color: '#64748B', textOnColor: '#FFFFFF' },
  artisan_assigne: { label: 'Artisan assigné', color: '#3B82F6', textOnColor: '#FFFFFF' },
  devis_envoye: { label: 'Devis envoyé', color: '#F59E0B', textOnColor: '#FFFFFF' },
  devis_signe: { label: 'Devis signé', color: '#22C55E', textOnColor: '#FFFFFF' },
  perdu: { label: 'Perdu', color: '#EF4444', textOnColor: '#FFFFFF' },
}

/** Ordre d'affichage des statuts dans le pipeline. */
export const STATUTS_ORDRE: StatutProjet[] = [
  'nouveau',
  'artisan_assigne',
  'devis_envoye',
  'devis_signe',
  'perdu',
]

/** Taux de commission Celexia (10 %). La valeur réelle est calculée par la base. */
export const TAUX_COMMISSION = 0.1

/** Couleur de marque (violet 600) pour les pins artisans sur la carte. */
export const COULEUR_ARTISAN = '#7C3AED'

/** Centre de la carte (France) + zoom par défaut. */
export const CARTE_CENTRE: [number, number] = [46.6, 2.5]
export const CARTE_ZOOM = 6
