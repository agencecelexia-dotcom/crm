// Types TypeScript reflétant le schéma Supabase (voir /supabase/migrations).
// On les maintient à la main (pas de génération auto) pour rester simple.

/** Statuts possibles d'un projet (pipeline). */
export type StatutProjet =
  | 'nouveau'
  | 'artisan_assigne'
  | 'devis_envoye'
  | 'devis_signe'
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
  created_at: string
  updated_at: string
}

/** Données d'insertion / mise à jour d'un artisan (champs gérés par la base exclus). */
export type ArtisanInput = Omit<Artisan, 'id' | 'created_at' | 'updated_at'>

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
  metier: string
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
  commission: number | null // colonne calculée par la base (10 %)
  commission_encaissee: boolean
  date_signature: string | null
  // Fichiers
  contrat_url: string | null
  devis_url: string | null
  devis_signe_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Projet enrichi de son artisan (jointure pour l'affichage). */
export interface ProjetAvecArtisan extends Projet {
  artisan: Pick<Artisan, 'id' | 'nom' | 'prenom' | 'societe'> | null
}

/** Champs éditables d'un projet (le reste est géré par la base). */
export type ProjetInput = Omit<
  Projet,
  'id' | 'commission' | 'created_by' | 'created_at' | 'updated_at'
>

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
  signed_at: string | null
  artisan: { nom: string; prenom: string | null; societe: string | null }
}
