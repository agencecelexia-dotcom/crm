import type { StatutProjet } from '@/types/database'

// ------------------------------------------------------------
//  Constantes métier partagées dans toute l'app
// ------------------------------------------------------------

/**
 * Taxonomie métiers → sous-métiers.
 * Quand on enregistre un artisan, on coche précisément les sous-métiers qu'il fait.
 * Quand on crée un projet, on peut préciser le sous-métier requis → matching fiable.
 */
export const SOUS_METIERS: Record<string, string[]> = {
  'Clôture': [
    'Clôture aluminium', 'Clôture bois', 'Clôture composite', 'Clôture PVC',
    'Clôture grillagée / rigide', 'Clôture béton', 'Mur / muret', 'Garde-corps',
  ],
  'Piscine': [
    'Piscine béton enterrée', 'Piscine coque polyester', 'Piscine hors-sol',
    'Liner / étanchéité', 'Margelles', 'Local technique / filtration',
    'Volet / abri de piscine', 'Chauffage de piscine',
  ],
  'Paysagisme': [
    'Création de jardin', 'Engazonnement / pelouse', 'Plantation',
    'Arrosage automatique', 'Élagage / abattage', 'Allées / pavage',
    'Clôture végétale', 'Entretien espaces verts',
  ],
  'CVC': [
    'Pompe à chaleur', 'Climatisation', 'Chaudière gaz', 'Chaudière fioul',
    'Plancher chauffant', 'Ventilation / VMC', 'Radiateurs', 'Ballon thermodynamique',
  ],
  'Couverture': [
    'Toiture tuiles', 'Toiture ardoise', 'Toiture zinc', 'Toiture bac acier',
    'Charpente', 'Zinguerie / gouttières', 'Étanchéité toit-terrasse',
    'Fenêtre de toit / Velux', 'Démoussage',
  ],
  'Maçonnerie': [
    'Fondations', 'Murs / élévation', 'Dalle béton', 'Enduit / façade',
    'Ouverture mur porteur', 'Extension', 'Garage', 'Terrassement',
  ],
  'Menuiserie': [
    'Fenêtres PVC', 'Fenêtres alu', 'Fenêtres bois', 'Portes', 'Porte de garage',
    'Volets', 'Véranda', 'Pergola', 'Dressing / placard', 'Parquet',
  ],
  'Électricité': [
    'Tableau électrique', 'Mise aux normes', 'Rénovation complète', 'Domotique',
    'Borne de recharge VE', 'Éclairage', 'Interphone / visiophone',
  ],
  'Plomberie': [
    'Salle de bain', 'Cuisine', 'Chauffe-eau', 'Recherche de fuite',
    'Évacuation / canalisation', 'Robinetterie', 'WC / sanitaires',
  ],
  'Terrasse': [
    'Terrasse bois', 'Terrasse composite', 'Terrasse carrelage', 'Terrasse pierre',
    'Terrasse béton', 'Dalle sur plots', 'Pergola / couverture',
  ],
  'Portail': [
    'Portail battant', 'Portail coulissant', 'Motorisation', 'Portillon',
    'Interphone', 'Automatisme',
  ],
  'Toiture': [
    'Réfection toiture', 'Isolation toiture', 'Nettoyage / démoussage',
    'Étanchéité', 'Charpente', 'Fenêtre de toit',
  ],
  'Isolation': [
    'Combles perdus', 'Combles aménagés', 'Murs intérieurs',
    'Isolation extérieure (ITE)', 'Sol', 'Sous-toiture',
  ],
  'Rénovation': [
    'Rénovation complète', 'Cuisine', 'Salle de bain', 'Peinture',
    'Carrelage', 'Plâtrerie / cloisons', 'Sols / revêtements',
  ],
}

/** Liste des métiers (dérivée de la taxonomie pour rester synchronisée). */
export const METIERS = Object.keys(SOUS_METIERS)

/** Régions françaises pour la zone d'intervention (18 régions officielles + national). */
export const REGIONS = [
  'France entière',
  // Métropole (13)
  'Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Hauts-de-France',
  'Île-de-France',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  "Provence-Alpes-Côte d'Azur",
  // Outre-mer (5)
  'Guadeloupe',
  'Martinique',
  'Guyane',
  'La Réunion',
  'Mayotte',
]

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

/**
 * Webhook n8n des notifications/envois (workflow "CRM Celexia — Notifications").
 * Non secret (simple URL de webhook) ; utilisé aussi par les triggers Supabase.
 */
export const N8N_WEBHOOK_URL =
  'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events'
