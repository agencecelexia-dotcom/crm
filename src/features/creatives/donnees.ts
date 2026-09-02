/**
 * Catalogue des modèles mis en avant, et formats publicitaires.
 *
 * fal compte 1 491 modèles et n'expose PAS leurs tarifs par API : ce fichier
 * est donc la seule source de vérité des prix. Les vérifier de temps en temps
 * sur fal.ai — un tarif faux ici affiche un coût faux à l'écran.
 *
 * La liste n'est pas limitative : l'écran accepte n'importe quel identifiant
 * fal, et le formulaire se construit depuis le schéma du modèle. Ces entrées
 * ne sont que des raccourcis pour les usages courants.
 */

export type CategorieModele = 'text-to-image' | 'image-to-image'

export interface ModeleFavori {
  id: string
  titre: string
  categorie: CategorieModele
  /** Prix par image en dollars. `null` quand fal ne l'annonce pas. */
  prixUsd: number | null
  /** Ce à quoi il sert, en une ligne. */
  usage: string
}

/**
 * Au-delà de ce prix, une confirmation explicite est demandée.
 *
 * L'écart entre modèles va de 0,0045 $ à 5,00 $ — un facteur mille. Sans
 * palier, vingt clics sur le mauvais modèle coûtent cent dollars.
 */
export const SEUIL_CONFIRMATION_USD = 0.5

export const MODELES: ModeleFavori[] = [
  {
    id: 'fal-ai/flux/schnell',
    titre: 'Flux Schnell',
    categorie: 'text-to-image',
    prixUsd: 0.003,
    usage: 'Le plus rapide et le moins cher. À utiliser pour explorer des idées.',
  },
  {
    id: 'bytedance/seedream/v5/pro/text-to-image',
    titre: 'Seedream v5 Pro',
    categorie: 'text-to-image',
    prixUsd: 0.0045,
    usage: 'Excellent rapport qualité-prix. Bon rendu photographique.',
  },
  {
    id: 'fal-ai/flux-2-pro',
    titre: 'Flux 2 Pro',
    categorie: 'text-to-image',
    prixUsd: 0.03,
    usage: 'Qualité supérieure, respect fidèle du texte demandé.',
  },
  {
    id: 'fal-ai/nano-banana',
    titre: 'Nano Banana',
    categorie: 'text-to-image',
    prixUsd: 0.039,
    usage: 'Modèle Google. Très bon sur les scènes réalistes.',
  },
  {
    id: 'fal-ai/nano-banana/edit',
    titre: 'Nano Banana — retouche',
    categorie: 'image-to-image',
    prixUsd: 0.039,
    usage: 'Modifie une image existante à partir d’une consigne écrite.',
  },
  {
    id: 'fal-ai/bytedance/seedream/v4/edit',
    titre: 'Seedream v4 — retouche',
    categorie: 'image-to-image',
    prixUsd: null,
    usage: 'Retouche économique. Utile pour décliner un visuel validé.',
  },
]

export interface FormatPub {
  cle: string
  label: string
  usage: string
  /** Valeurs possibles selon la convention du modèle interrogé. */
  valeurs: string[]
}

/**
 * Les formats qui servent réellement aux campagnes.
 *
 * Chaque modèle nomme sa dimension à sa façon — `image_size` chez Flux,
 * `aspect_ratio` chez Nano Banana. Les valeurs listées couvrent les deux
 * conventions ; le formulaire retient celle que le schéma propose.
 */
export const FORMATS: FormatPub[] = [
  {
    cle: '1:1',
    label: 'Carré 1:1',
    usage: 'Fil Facebook et Instagram',
    valeurs: ['square_hd', 'square', '1:1'],
  },
  {
    cle: '4:5',
    label: 'Portrait 4:5',
    usage: 'Fil Instagram, le plus performant',
    valeurs: ['portrait_4_3', '4:5', '3:4'],
  },
  {
    cle: '9:16',
    label: 'Vertical 9:16',
    usage: 'Stories et Reels',
    valeurs: ['portrait_16_9', '9:16'],
  },
  {
    cle: '2:3',
    label: 'Pinterest 2:3',
    usage: 'Format natif Pinterest',
    valeurs: ['2:3', 'portrait_4_3'],
  },
  {
    cle: '16:9',
    label: 'Paysage 16:9',
    usage: 'YouTube, bandeaux, site',
    valeurs: ['landscape_16_9', '16:9'],
  },
]

/** Champs du schéma que l'écran gère lui-même : inutile de les redemander. */
export const CHAMPS_PILOTES = ['prompt', 'image_size', 'aspect_ratio', 'num_images']
