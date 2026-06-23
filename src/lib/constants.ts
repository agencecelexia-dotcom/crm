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
    'Isolation phonique', 'Calorifugeage',
  ],
  'Rénovation': [
    'Rénovation complète', 'Cuisine', 'Salle de bain', 'Peinture',
    'Carrelage', 'Plâtrerie / cloisons', 'Sols / revêtements',
  ],
  'Peinture': [
    'Peinture intérieure', 'Peinture extérieure', 'Papier peint / toile',
    'Enduits décoratifs', 'Boiseries / laque', 'Préparation / ratissage',
  ],
  'Plâtrerie / Placo': [
    'Cloisons / doublage', 'Faux plafond', 'Plafond tendu',
    'Staff / corniches', 'Enduit / bandes', 'Isolation intérieure',
  ],
  'Carrelage': [
    'Carrelage sol', 'Faïence murale', 'Mosaïque', 'Pierre naturelle',
    'Grand format', 'Rénovation des joints',
  ],
  'Façade / Ravalement': [
    'Ravalement de façade', 'Isolation extérieure (ITE)', 'Enduit de façade',
    'Bardage de façade', 'Nettoyage / hydrofuge', 'Peinture de façade',
  ],
  'Solaire / Photovoltaïque': [
    'Panneaux photovoltaïques', 'Solaire thermique', 'Ballon solaire',
    'Batterie / stockage', 'Borne de recharge VE', 'Carport solaire',
  ],
  'Petits travaux / Multiservices': [
    'Dépannage / bricolage', 'Montage de meubles', 'Pose (tringles, étagères…)',
    'Petites réparations', 'Manutention / débarras', 'Petits travaux extérieurs',
  ],
  'Serrurerie / Métallerie': [
    'Serrurerie / dépannage', 'Garde-corps / rambarde', 'Grille / barreaudage',
    'Escalier métallique', 'Ferronnerie', 'Blindage de porte',
  ],
}

/** Liste des métiers (dérivée de la taxonomie pour rester synchronisée). */
export const METIERS = Object.keys(SOUS_METIERS)

/** Départements français (code officiel + nom) — pour une saisie de zone normée. */
export const DEPARTEMENTS: { code: string; nom: string }[] = [
  { code: '01', nom: 'Ain' }, { code: '02', nom: 'Aisne' }, { code: '03', nom: 'Allier' },
  { code: '04', nom: 'Alpes-de-Haute-Provence' }, { code: '05', nom: 'Hautes-Alpes' },
  { code: '06', nom: 'Alpes-Maritimes' }, { code: '07', nom: 'Ardèche' }, { code: '08', nom: 'Ardennes' },
  { code: '09', nom: 'Ariège' }, { code: '10', nom: 'Aube' }, { code: '11', nom: 'Aude' },
  { code: '12', nom: 'Aveyron' }, { code: '13', nom: 'Bouches-du-Rhône' }, { code: '14', nom: 'Calvados' },
  { code: '15', nom: 'Cantal' }, { code: '16', nom: 'Charente' }, { code: '17', nom: 'Charente-Maritime' },
  { code: '18', nom: 'Cher' }, { code: '19', nom: 'Corrèze' }, { code: '2A', nom: 'Corse-du-Sud' },
  { code: '2B', nom: 'Haute-Corse' }, { code: '21', nom: "Côte-d'Or" }, { code: '22', nom: "Côtes-d'Armor" },
  { code: '23', nom: 'Creuse' }, { code: '24', nom: 'Dordogne' }, { code: '25', nom: 'Doubs' },
  { code: '26', nom: 'Drôme' }, { code: '27', nom: 'Eure' }, { code: '28', nom: 'Eure-et-Loir' },
  { code: '29', nom: 'Finistère' }, { code: '30', nom: 'Gard' }, { code: '31', nom: 'Haute-Garonne' },
  { code: '32', nom: 'Gers' }, { code: '33', nom: 'Gironde' }, { code: '34', nom: 'Hérault' },
  { code: '35', nom: 'Ille-et-Vilaine' }, { code: '36', nom: 'Indre' }, { code: '37', nom: 'Indre-et-Loire' },
  { code: '38', nom: 'Isère' }, { code: '39', nom: 'Jura' }, { code: '40', nom: 'Landes' },
  { code: '41', nom: 'Loir-et-Cher' }, { code: '42', nom: 'Loire' }, { code: '43', nom: 'Haute-Loire' },
  { code: '44', nom: 'Loire-Atlantique' }, { code: '45', nom: 'Loiret' }, { code: '46', nom: 'Lot' },
  { code: '47', nom: 'Lot-et-Garonne' }, { code: '48', nom: 'Lozère' }, { code: '49', nom: 'Maine-et-Loire' },
  { code: '50', nom: 'Manche' }, { code: '51', nom: 'Marne' }, { code: '52', nom: 'Haute-Marne' },
  { code: '53', nom: 'Mayenne' }, { code: '54', nom: 'Meurthe-et-Moselle' }, { code: '55', nom: 'Meuse' },
  { code: '56', nom: 'Morbihan' }, { code: '57', nom: 'Moselle' }, { code: '58', nom: 'Nièvre' },
  { code: '59', nom: 'Nord' }, { code: '60', nom: 'Oise' }, { code: '61', nom: 'Orne' },
  { code: '62', nom: 'Pas-de-Calais' }, { code: '63', nom: 'Puy-de-Dôme' },
  { code: '64', nom: 'Pyrénées-Atlantiques' }, { code: '65', nom: 'Hautes-Pyrénées' },
  { code: '66', nom: 'Pyrénées-Orientales' }, { code: '67', nom: 'Bas-Rhin' }, { code: '68', nom: 'Haut-Rhin' },
  { code: '69', nom: 'Rhône' }, { code: '70', nom: 'Haute-Saône' }, { code: '71', nom: 'Saône-et-Loire' },
  { code: '72', nom: 'Sarthe' }, { code: '73', nom: 'Savoie' }, { code: '74', nom: 'Haute-Savoie' },
  { code: '75', nom: 'Paris' }, { code: '76', nom: 'Seine-Maritime' }, { code: '77', nom: 'Seine-et-Marne' },
  { code: '78', nom: 'Yvelines' }, { code: '79', nom: 'Deux-Sèvres' }, { code: '80', nom: 'Somme' },
  { code: '81', nom: 'Tarn' }, { code: '82', nom: 'Tarn-et-Garonne' }, { code: '83', nom: 'Var' },
  { code: '84', nom: 'Vaucluse' }, { code: '85', nom: 'Vendée' }, { code: '86', nom: 'Vienne' },
  { code: '87', nom: 'Haute-Vienne' }, { code: '88', nom: 'Vosges' }, { code: '89', nom: 'Yonne' },
  { code: '90', nom: 'Territoire de Belfort' }, { code: '91', nom: 'Essonne' },
  { code: '92', nom: 'Hauts-de-Seine' }, { code: '93', nom: 'Seine-Saint-Denis' },
  { code: '94', nom: 'Val-de-Marne' }, { code: '95', nom: "Val-d'Oise" },
  { code: '971', nom: 'Guadeloupe' }, { code: '972', nom: 'Martinique' }, { code: '973', nom: 'Guyane' },
  { code: '974', nom: 'La Réunion' }, { code: '976', nom: 'Mayotte' },
]

/** Codes de départements valides (pour normaliser/valider une zone). */
export const DEPARTEMENTS_CODES = new Set(DEPARTEMENTS.map((d) => d.code))
export const DEPARTEMENT_NOM = (code: string) =>
  DEPARTEMENTS.find((d) => d.code === code)?.nom ?? code

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
  contacte: { label: 'Client contacté', color: '#0EA5E9', textOnColor: '#FFFFFF' },
  rdv_pris: { label: 'RDV pris', color: '#8B5CF6', textOnColor: '#FFFFFF' },
  devis_envoye: { label: 'Devis envoyé', color: '#F59E0B', textOnColor: '#FFFFFF' },
  devis_signe: { label: 'Devis signé', color: '#22C55E', textOnColor: '#FFFFFF' },
  termine: { label: 'Terminé', color: '#0F766E', textOnColor: '#FFFFFF' },
  perdu: { label: 'Perdu', color: '#EF4444', textOnColor: '#FFFFFF' },
}

/** Ordre d'affichage des statuts dans le pipeline. */
export const STATUTS_ORDRE: StatutProjet[] = [
  'nouveau',
  'a_rappeler',
  'en_attente',
  'artisan_assigne',
  'contacte',
  'rdv_pris',
  'devis_envoye',
  'devis_signe',
  'termine',
  'perdu',
]

/** Statuts de suivi déclarables par l'artisan (parcours après mise en relation). */
export const SUIVI_STATUTS: Record<string, { label: string; color: string; emoji: string }> = {
  contacte: { label: 'Client contacté', color: '#3B82F6', emoji: '📞' },
  rdv_pris: { label: 'RDV pris', color: '#8B5CF6', emoji: '📅' },
  en_attente: { label: 'En attente', color: '#06B6D4', emoji: '⏳' },
  devis_envoye: { label: 'Devis envoyé', color: '#F59E0B', emoji: '📄' },
  devis_signe: { label: 'Devis signé', color: '#22C55E', emoji: '✅' },
  termine: { label: 'Projet terminé', color: '#0F766E', emoji: '🏁' },
  perdu: { label: 'Pas de suite / Perdu', color: '#EF4444', emoji: '✖️' },
}
export const SUIVI_ORDRE = [
  'contacte',
  'rdv_pris',
  'en_attente',
  'devis_envoye',
  'devis_signe',
  'termine',
  'perdu',
] as const

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
