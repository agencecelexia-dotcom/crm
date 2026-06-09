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
  rayon_km: number | null
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
  created_at: string
  updated_at: string
}

/** Données d'insertion / mise à jour d'un artisan (champs gérés par la base exclus). */
export type ArtisanInput = Omit<Artisan, 'id' | 'token' | 'created_at' | 'updated_at'>

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
  taux_commission: number // taux appliqué à ce projet (ex: 0.10)
  commission: number | null // colonne calculée par la base (montant signé × taux)
  commission_encaissee: boolean
  date_signature: string | null
  perdu_at: string | null // date de passage en "perdu" (purge auto 48h après)
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
  | 'created_by'
  | 'created_at'
  | 'updated_at'
  | 'photos'
> & { photos?: string[] }

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

/** Réponse de get_espace_artisan : contrat unique + tous les chantiers de l'artisan. */
export interface EspaceArtisan {
  artisan: { nom: string; prenom: string | null; societe: string | null }
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
  projets: ProjetEspace[]
}
