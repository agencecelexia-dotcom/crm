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
  /** Perdu par UN artisan — le chantier reste vivant et réattribuable. */
  | 'perdu'
  /** Lead définitivement mort (client parti ailleurs) — réservé à l'agence. */
  | 'mort'
  /**
   * Ce n'est pas un client : un artisan qui cherche du travail.
   *
   * Distinct de « mort », qui désigne un lead perdu. Celui-ci n'a jamais été
   * un lead — mais c'est un fournisseur potentiel, utile là où aucun artisan
   * n'est encore couvert. À ne jamais rappeler comme prospect.
   */
  | 'artisan_demarche'
  /**
   * Sollicitation commerciale : agence web, référencement, assurance, énergie.
   *
   * Ni un client, ni un fournisseur potentiel. Contrairement à
   * « artisan_demarche », la fiche n'a aucune valeur future — elle sert
   * uniquement à ne pas rappeler ce numéro et à le reconnaître s'il insiste.
   */
  | 'demarchage'

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
  /** Identifiant du suivi. Renvoyé par la base, il manquait ici. */
  id?: string
  auteur: 'artisan' | 'agence'
  /** `appel` existe en base (bouton d'appel de l'espace artisan) et manquait. */
  type: 'statut' | 'note' | 'appel'
  statut: StatutSuivi | null
  message: string | null
  created_at: string
  /** Accusé de lecture des messages agence (migration 0080). */
  lu_at?: string | null
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
/** Étape du funnel réellement atteinte. Monotone : ne recule jamais seule. */
export type EtapeFunnel = 'contacte' | 'rdv_pris' | 'devis_envoye' | 'devis_signe' | 'termine'

/** Issue commerciale, orthogonale à l'étape (migration 0073). */
export type IssueChantier = 'en_cours' | 'gagne' | 'perdu'

export const ETAPES_ORDRE: EtapeFunnel[] = [
  'contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine',
]

export const ETAPE_LABEL: Record<EtapeFunnel, string> = {
  contacte: 'Client contacté',
  rdv_pris: 'RDV pris',
  devis_envoye: 'Devis envoyé',
  devis_signe: 'Devis signé',
  termine: 'Chantier terminé',
}

export function rangEtape(e: EtapeFunnel | null | undefined): number {
  return e ? ETAPES_ORDRE.indexOf(e) + 1 : 0
}

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
  /** URLs des PDF déposés — permettent à l'artisan de RELIRE son devis
   *  (migration 0072), pas seulement de savoir qu'un fichier existe. */
  devis_url?: string | null
  devis_signe_url?: string | null
  /** --- Modèle à deux axes (migration 0073) --- */
  etape?: EtapeFunnel | null
  issue?: IssueChantier
  /** Drapeaux secondaires : s'affichent EN PLUS de l'étape, ne l'écrasent plus. */
  en_attente_depuis?: string | null
  rappel_le?: string | null
  /** --- Dimension temporelle (audit §4) --- */
  recu_le?: string | null
  derniere_activite?: string | null
  date_rdv?: string | null
  /** Messages de l'agence non lus sur ce chantier (migration 0081). */
  non_lus?: number
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
  /** Chantiers sortis du pipe : retirés par l'artisan, masqués par l'agence,
   *  ou perdus depuis plus de 15 jours. Migration 0070. */
  projets_perdus?: ProjetPerdu[]
  projets: ProjetEspace[]
  /**
   * Statistiques calculées côté base sur TOUTES les affectations de l'artisan,
   * y compris celles sorties de son pipe (masquées, perdues depuis plus de
   * 15 jours, projets morts) — nettoyer sa liste ne fausse jamais ses chiffres.
   * Absent tant que la migration 0062 n'est pas exécutée → repli sur le calcul
   * à partir de `projets`.
   */
  stats?: StatsEspaceArtisan
}

/** Bloc `stats` renvoyé par `get_espace_artisan` (migration 0062). */
/**
 * KPI d'un artisan, calculés sur les FAITS par `stats_artisan_faits()`
 * (migrations 0075/0076) et non plus sur le champ `statut`.
 */
/**
 * Un cran du funnel, décomposé.
 *
 * `atteint` est MONOTONE : il compte les dossiers ayant franchi ce cran au
 * moins une fois, même perdus depuis. Le lire seul laisse croire à des
 * affaires gagnées — d'où la décomposition obligatoire.
 * Invariant garanti en base : atteint = actif + perdu + gagne.
 */
export interface CranFunnelStats {
  atteint: number
  actif: number
  perdu: number
  gagne: number
}

export interface StatsEspaceArtisan {
  funnel: Record<'contacte' | 'rdv_pris' | 'devis_envoye' | 'devis_signe' | 'termine', CranFunnelStats>
  /** Signatures appuyées par un PDF ou un montant : seule base facturable. */
  signatures_prouvees: number
  /** Déclarées au stepper sans aucune preuve matérielle. */
  signatures_declarees_sans_preuve: number
  leads_recus: number
  en_cours: number
  gagnes: number
  perdus: number
  /** Funnel cumulatif : « a atteint au moins cette étape ». */
  contactes: number
  rdv: number
  devis_envoyes: number
  devis_signes: number
  termines: number
  montant_devis_total: number
  panier_moyen: number
  panier_median: number
  ca_signe: number
  pipe_en_cours: number
  montant_perdu: number
  commission_due: number
  commission_reglee: number
  tranches: number
  taux_contact: number | null
  taux_rdv: number | null
  taux_devis: number | null
  /** Parmi les dossiers réellement chiffrés et arbitrés. */
  taux_signature: number | null
  /** Part des leads refusés avant tout chiffrage — qualité des leads. */
  taux_refus_avant_devis: number | null
  /** Médianes, robustes aux saisies rétroactives. */
  /** Médiane, publiée seulement à partir de 3 observations exploitables. */
  delai_contact_j: number | null
  /** Effectif ayant servi au calcul — affiché pour situer la fiabilité. */
  delai_contact_n: number
  delai_devis_j: number | null
  delai_devis_n: number
  delai_signature_j: number | null
  delai_signature_n: number
  rappels_echus: number
  jamais_contactes_48h: number
  devis_sans_reponse_15j: number
}

/**
 * Pièce jointe libre d'un projet (table `projet_documents`, migration 0069).
 *
 * `chemin` est un chemin de stockage dans le bucket PRIVÉ `documents`, jamais
 * une URL : on génère une URL signée à la demande via `urlSignee()`.
 * `nom` conserve le nom d'origine du fichier, seul élément affiché.
 */
export interface ProjetDocument {
  id: string
  projet_id: string
  nom: string
  chemin: string
  taille_octets: number | null
  /** Type MIME d'origine. Null sur les pièces déposées avant 0098 (toutes PDF). */
  type_mime: string | null
  /** Si vrai, la pièce est transmise à l'artisan affecté (défaut à la création). */
  visible_artisan: boolean
  created_at: string
}

/**
 * Pièce jointe telle que la voit l'ARTISAN (RPC `documents_projet_par_token`).
 *
 * Volontairement amputée de `chemin` : le chemin de stockage ne sort jamais du
 * serveur. Pour consulter, on échange (token, id) contre une URL signée d'une
 * heure auprès de l'edge function `document-signe`.
 */
export interface DocumentPartage {
  id: string
  nom: string
  type_mime: string | null
  taille_octets: number | null
  created_at: string
}

/**
 * Chantier sorti du pipe de l'artisan (bloc `projets_perdus` de
 * `get_espace_artisan`, migration 0070).
 *
 * Volontairement plus pauvre que `ProjetEspace` : aucune coordonnée client
 * n'est exposée sur un chantier que l'artisan ne suit plus.
 */
export interface ProjetPerdu {
  /** id de l'AFFECTATION (pas du projet). */
  id: string
  /** token d'affectation — sert à la restauration. */
  token: string
  statut: StatutProjet
  metier: string
  metiers: string[]
  sous_metier: string | null
  description: string | null
  budget_estime: number | null
  montant_devis: number | null
  client_ville: string | null
  sorti_le: string
  /** Pourquoi il est sorti du pipe. */
  motif: 'retrait' | 'perdu' | 'masque'
  /** false si le projet est repris par un confrère ou clos par l'agence. */
  restaurable: boolean
  /** Dernier message de suivi (souvent la raison saisie au retrait). */
  derniere_raison: string | null
  /** Nom du client, absent de cette vue auparavant. */
  client_nom?: string | null
  client_telephone?: string | null
  client_code_postal?: string | null
  /**
   * Historique complet, ajouté en 0094.
   *
   * Un résumé d'une ligne ne permet pas de décider d'une réattribution : il
   * faut savoir jusqu'où le dossier est allé, s'il a été chiffré et pourquoi
   * il s'est arrêté.
   */
  recu_le?: string | null
  etape?: string | null
  date_rdv?: string | null
  montant_devis_signe?: number | null
  devis_url?: string | null
  devis_signe_url?: string | null
  devis_depose?: boolean
  suivis?: Suivi[]
  /** Motif normalisé (migration 0079). */
  motif_perte?: string | null
}
