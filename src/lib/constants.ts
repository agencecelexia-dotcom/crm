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

/** 18 régions officielles (13 métropole + 5 outre-mer). */
export const REGIONS = [
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
  'Guadeloupe',
  'Martinique',
  'Guyane',
  'La Réunion',
  'Mayotte',
]

/** 101 départements français (code + nom) — recherche par nom ou numéro. */
export const DEPARTEMENTS = [
  '01 - Ain', '02 - Aisne', '03 - Allier', '04 - Alpes-de-Haute-Provence',
  '05 - Hautes-Alpes', '06 - Alpes-Maritimes', '07 - Ardèche', '08 - Ardennes',
  '09 - Ariège', '10 - Aube', '11 - Aude', '12 - Aveyron', '13 - Bouches-du-Rhône',
  '14 - Calvados', '15 - Cantal', '16 - Charente', '17 - Charente-Maritime',
  '18 - Cher', '19 - Corrèze', '2A - Corse-du-Sud', '2B - Haute-Corse',
  "21 - Côte-d'Or", "22 - Côtes-d'Armor", '23 - Creuse', '24 - Dordogne',
  '25 - Doubs', '26 - Drôme', '27 - Eure', '28 - Eure-et-Loir', '29 - Finistère',
  '30 - Gard', '31 - Haute-Garonne', '32 - Gers', '33 - Gironde', '34 - Hérault',
  '35 - Ille-et-Vilaine', '36 - Indre', '37 - Indre-et-Loire', '38 - Isère',
  '39 - Jura', '40 - Landes', '41 - Loir-et-Cher', '42 - Loire', '43 - Haute-Loire',
  '44 - Loire-Atlantique', '45 - Loiret', '46 - Lot', '47 - Lot-et-Garonne',
  '48 - Lozère', '49 - Maine-et-Loire', '50 - Manche', '51 - Marne',
  '52 - Haute-Marne', '53 - Mayenne', '54 - Meurthe-et-Moselle', '55 - Meuse',
  '56 - Morbihan', '57 - Moselle', '58 - Nièvre', '59 - Nord', '60 - Oise',
  '61 - Orne', '62 - Pas-de-Calais', '63 - Puy-de-Dôme', '64 - Pyrénées-Atlantiques',
  '65 - Hautes-Pyrénées', '66 - Pyrénées-Orientales', '67 - Bas-Rhin', '68 - Haut-Rhin',
  '69 - Rhône', '70 - Haute-Saône', '71 - Saône-et-Loire', '72 - Sarthe',
  '73 - Savoie', '74 - Haute-Savoie', '75 - Paris', '76 - Seine-Maritime',
  '77 - Seine-et-Marne', '78 - Yvelines', '79 - Deux-Sèvres', '80 - Somme',
  '81 - Tarn', '82 - Tarn-et-Garonne', '83 - Var', '84 - Vaucluse', '85 - Vendée',
  '86 - Vienne', '87 - Haute-Vienne', '88 - Vosges', '89 - Yonne',
  '90 - Territoire de Belfort', '91 - Essonne', '92 - Hauts-de-Seine',
  '93 - Seine-Saint-Denis', '94 - Val-de-Marne', "95 - Val-d'Oise",
  '971 - Guadeloupe', '972 - Martinique', '973 - Guyane', '974 - La Réunion',
  '976 - Mayotte',
]

/**
 * Zones d'intervention proposées (recherchables) : national, régions puis départements.
 * On stocke la chaîne choisie telle quelle dans artisans.zone_intervention.
 */
export const ZONES_INTERVENTION = [
  'France entière',
  ...REGIONS.map((r) => `Région : ${r}`),
  ...DEPARTEMENTS,
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
  a_rappeler: { label: 'À rappeler', color: '#F97316', textOnColor: '#FFFFFF' },
  en_attente: { label: 'En attente', color: '#06B6D4', textOnColor: '#FFFFFF' },
  artisan_assigne: { label: 'Artisan assigné', color: '#3B82F6', textOnColor: '#FFFFFF' },
  devis_envoye: { label: 'Devis envoyé', color: '#F59E0B', textOnColor: '#FFFFFF' },
  devis_signe: { label: 'Devis signé', color: '#22C55E', textOnColor: '#FFFFFF' },
  perdu: { label: 'Perdu', color: '#EF4444', textOnColor: '#FFFFFF' },
}

/** Ordre d'affichage des statuts dans le pipeline. */
export const STATUTS_ORDRE: StatutProjet[] = [
  'nouveau',
  'a_rappeler',
  'en_attente',
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
