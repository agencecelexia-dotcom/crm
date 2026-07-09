// Types TypeScript reflétant le schéma Supabase (voir /supabase/migrations).
// On les maintient à la main (pas de génération auto) pour rester simple.

/** Statuts possibles d'un projet (pipeline). */
export type StatutProjet =
  | 'nouveau'
  | 'a_rappeler'
  | 'en_attente'
  | 'artisan_assigne'
  | 'contacte'
  | 'rdv_pris'
  | 'devis_envoye'
  | 'devis_signe'
  | 'termine'
  | 'perdu'

/** Une zone d'intervention = une ville (géocodée) + un rayon (km). */
export interface ZoneCouverte {
  ville: string
  lat: number | null
  lon: number | null
  rayon_km: number
}

/** Un artisan référencé dans la base. */
export interface Artisan {
  id: string
  nom: string
  prenom: string | null
  societe: string | null
  telephone: string | null
  email: string | null
  metiers: string[]
  sous_metiers: string[]
  zone_intervention: string | null
  rayon_km: number | null // rayon de service autour de l'adresse (legacy / mode rayon simple)
  departements_couverts: string[] // départements desservis déclarés (mode départements)
  zones_couvertes: ZoneCouverte[] // villes + rayon, secteurs non contigus (Nantes 50, Paris 30…)
  adresse: string | null
  ville: string | null
  code_postal: string | null
  latitude: number | null
  longitude: number | null
  specificites: string | null
  // Infos société (pour le contrat) — auto-remplies via SIRET, éditables
  forme_juridique: string | null
  capital_social: string | null
  siren: string | null
  ville_immatriculation: string | null
  representant: string | null
  qualite_representant: string | null
  taux_commission: number // taux par défaut de l'artisan (ex: 0.10)
  token: string // lien public "espace artisan" (/artisan/:token)
  contrat_externe: boolean // contrat signé hors application (pas de signature dans l'espace)
  ecarte_at: string | null // "pas fiable" : écarté (hors liste active) mais conservé
  ecarte_motif: string | null // raison de la mise à l'écart
  source: string | null // origine : agence | demarchage | auto:facebook | auto:whatsapp …
  nb_salaries: number | null
  annees_experience: number | null
  assurance_rc_pro: boolean | null
  assurance_decennale: boolean | null
  // Scoring interne (jamais exposé à l'artisan) — notes qualitatives manuelles /5
  note_elocution: number | null // « comment il parle » (expression, contact client)
  note_communication_agence: number | null // réactivité / échange avec l'agence
  created_at: string
  updated_at: string
}

/** Scoring artisan calculé côté serveur (RPC scoring_artisan). Interne uniquement. */
export interface ScoringArtisan {
  note_elocution: number | null
  note_communication_agence: number | null
  nb_projets: number
  vitesse: { h_contact: number | null; n_contact: number; h_devis: number | null; n_devis: number }
  transfo: { n_devis_envoyes: number; n_signes: number }
  face_a_face: { n_duels: number; n_gagnes: number }
}

/** Données d'insertion / mise à jour d'un artisan (champs gérés par la base exclus). */
export type ArtisanInput = Omit<
  Artisan,
  | 'id'
  | 'token'
  | 'contrat_externe'
  | 'ecarte_at'
  | 'ecarte_motif'
  | 'source'
  | 'created_at'
  | 'updated_at'
  | 'departements_couverts'
  | 'zones_couvertes'
  | 'nb_salaries'
  | 'annees_experience'
  | 'assurance_rc_pro'
  | 'assurance_decennale'
  | 'note_elocution'
  | 'note_communication_agence'
> & {
  departements_couverts?: string[]
  zones_couvertes?: ZoneCouverte[]
  nb_salaries?: number | null
  annees_experience?: number | null
  assurance_rc_pro?: boolean | null
  assurance_decennale?: boolean | null
}

/** Statut de démarchage d'une société (prospect). */
export type StatutProspect =
  | 'a_contacter'
  | 'pas_repondu'
  | 'negatif'
  | 'ok_autre_metier'
  | 'interesse'
  | 'converti'

/** Une société à démarcher (pool de prospection, distinct des artisans). */
export interface Prospect {
  id: string
  company_name: string | null
  profession: string | null
  metiers: string[]
  sous_metiers: string[]
  tel: string | null
  tel2: string | null
  email: string | null
  city: string | null
  code_postal: string | null
  departement: string | null
  website: string | null
  google_maps_url: string | null
  statut: StatutProspect
  nb_appels: number
  notes: string | null
  distance_km?: number // renvoyé par prospects_autour
}

/** Une zone de couverture (ville de référence, table zones). */
export interface Zone {
  id: string
  nom: string
  lat: number
  lon: number
  departement: string | null
  region: string | null
  population: number | null
}

export type StatutCouverture = 'couvert' | 'partiel' | 'vide'

/** Une cellule du tableau de couverture (zone × sous-niche) — RPC couverture_grille. */
export interface CouvertureCell {
  zone_id: string
  zone: string
  lat: number
  lon: number
  departement: string | null
  sous_metier: string
  n: number
  statut: StatutCouverture
}

/** Une zone agrégée pour la carte de couverture — RPC couverture_carte. */
export interface CouvertureZone {
  id: string
  nom: string
  lat: number
  lon: number
  departement: string | null
  n: number
  statut: StatutCouverture
}

/** Un projet = un appel client. */
export interface Projet {
  id: string
  // Client
  client_nom: string
  client_telephone: string | null
  client_email: string | null
  client_adresse: string | null
  client_ville: string | null
  client_code_postal: string | null
  latitude: number | null
  longitude: number | null
  // Demande
  metier: string // 1er métier (compat)
  metiers: string[] // tous les métiers demandés (un projet peut en avoir plusieurs)
  sous_metier: string | null
  description: string | null
  budget_estime: number | null
  // Attribution
  artisan_id: string | null
  // Pipeline
  statut: StatutProjet
  // Argent
  montant_devis: number | null
  montant_devis_signe: number | null
  estimation_interne: number | null // potentiel estimé (INTERNE, jamais visible par l'artisan)
  notes_internes: string | null // notes privées agence (INTERNE, jamais visible par l'artisan)
  taux_commission: number // taux appliqué à ce projet (ex: 0.10)
  commission: number | null // colonne calculée par la base (montant signé × taux)
  commission_encaissee: boolean
  date_signature: string | null
  perdu_at: string | null // date de passage en "perdu" (purge auto 48h après)
  deleted_at: string | null // corbeille : si renseigné, projet masqué mais restaurable
  // Fichiers
  contrat_url: string | null
  devis_url: string | null
  devis_signe_url: string | null
  photos: string[] // URLs publiques des photos du chantier (vues par l'artisan)
  token: string // lien public "espace artisan" (/mission/:token)
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Projet enrichi de son artisan (jointure pour l'affichage). */
export interface ProjetAvecArtisan extends Projet {
  artisan: Pick<Artisan, 'id' | 'nom' | 'prenom' | 'societe' | 'email'> | null
}

/** Champs éditables d'un projet (le reste est géré par la base). */
export type ProjetInput = Omit<
  Projet,
  | 'id'
  | 'commission'
  | 'token'
  | 'perdu_at'
  | 'deleted_at'
  | 'created_by'
  | 'created_at'
  | 'updated_at'
  | 'photos'
  | 'estimation_interne'
  | 'notes_internes'
> & { photos?: string[]; estimation_interne?: number | null; notes_internes?: string | null }

/** Entrée de suivi d'un projet (statut déclaré et/ou note, par l'artisan ou l'agence). */
export type StatutSuivi =
  | 'contacte'
  | 'rdv_pris'
  | 'en_attente'
  | 'devis_envoye'
  | 'devis_signe'
  | 'termine'
  | 'perdu'
export interface Suivi {
  auteur: 'artisan' | 'agence'
  type: 'statut' | 'note'
  statut: StatutSuivi | null
  message: string | null
  created_at: string
}

/** Note rapide attachée à un projet (suivi interne agence). */
export interface Note {
  id: string
  projet_id: string
  contenu: string
  auteur: string | null
  created_at: string
}

/** Contrat d'engagement Celexia ↔ artisan (signé en ligne via token public). */
export interface Contrat {
  id: string
  artisan_id: string
  type: string
  token: string
  contenu: string
  statut: 'envoye' | 'signe'
  signataire_nom: string | null
  signature_data: string | null
  apporteur_signature: string | null // signature CELEXIA (apposée à la génération)
  signed_at: string | null
  created_at: string
  updated_at: string
}

/** Vue publique d'un contrat (retournée par la fonction get_contrat_by_token). */
export interface ContratPublic {
  id: string
  type: string
  contenu: string
  statut: 'envoye' | 'signe'
  signataire_nom: string | null
  signature_data: string | null
  apporteur_signature: string | null
  signed_at: string | null
  artisan: { nom: string; prenom: string | null; societe: string | null }
}

/** Un chantier vu depuis l'espace artisan (identité client masquée tant que non signé). */
export interface ProjetEspace {
  id: string
  token: string // token du projet (pour suivi + upload devis)
  statut: StatutProjet
  metier: string
  metiers: string[]
  sous_metier: string | null
  description: string | null
  budget_estime: number | null
  montant_devis: number | null
  montant_devis_signe: number | null
  commission: number | null
  commission_encaissee: boolean
  client_ville: string | null
  photos: string[]
  devis_depose: boolean
  devis_signe_depose: boolean
  suivis: Suivi[]
  // Identité client : null tant que le contrat n'est pas signé
  client_nom: string | null
  client_telephone: string | null
  client_email: string | null
  client_adresse: string | null
  client_code_postal: string | null
}

/** Identité + infos société de l'artisan (en-tête de devis). */
export interface ArtisanEspace {
  id: string
  nom: string
  prenom: string | null
  societe: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
  siren: string | null
  forme_juridique: string | null
  telephone: string | null
  email: string | null
  representant: string | null
}

/** Une ligne de devis. */
export interface DevisLigne {
  designation: string
  quantite: number
  unite: string
  prix_unitaire: number
}

/** Un devis (généré par l'artisan). */
export interface Devis {
  id: string
  numero: string
  client_nom: string | null
  objet: string | null
  total: number
  statut: 'brouillon' | 'envoye'
  pdf_url: string | null
  date_devis: string
  sent_at: string | null
  projet_id: string | null
}

/** Réponse de get_espace_artisan : contrat unique + tous les chantiers de l'artisan. */
export interface EspaceArtisan {
  artisan: ArtisanEspace
  engagement: {
    token: string
    statut: 'envoye' | 'signe'
    contenu: string
    signataire_nom: string | null
    signed_at: string | null
    signature_data: string | null
    apporteur_signature: string | null
  }
  signe: boolean
  contrat_externe: boolean
  projets: ProjetEspace[]
}
