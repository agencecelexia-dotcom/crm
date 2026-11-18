/**
 * LE SCRIPT — source unique.
 *
 * Antoine lit ces textes face caméra ; la vidéo découpe ses scènes sur les
 * mêmes parties. Modifier un texte ici modifie à la fois le document remis à
 * Antoine (`npm run script-antoine`) et la voix provisoire.
 *
 * Les libellés entre « » sont ceux de l'écran : les garder à l'identique.
 */
export type IdPartie =
  | 'bienvenue'
  | 'pourquoi'
  | 'lien'
  | 'menu'
  | 'tableau'
  | 'liste'
  | 'fiche'
  | 'avancement'
  | 'appels'
  | 'notes'
  | 'devis'
  | 'retrait'
  | 'commissions'
  | 'reflexes'

export interface Partie {
  id: IdPartie
  /** Titre affiché en haut de l'écran pendant la partie. */
  titre: string
  /** Ce qu'Antoine dit. Une phrase par ligne pour la lecture. */
  texte: string[]
}

export const PARTIES: Partie[] = [
  {
    id: 'bienvenue',
    titre: 'Bienvenue chez Celexia',
    texte: [
      'Bonjour, c’est Antoine, de Celexia.',
      'Bienvenue, et merci d’avoir signé votre contrat.',
      'Avant d’accéder à vos chantiers, je vous montre en quelques minutes comment marche votre espace.',
      'Regardez jusqu’au bout : c’est la base pour bien travailler ensemble.',
    ],
  },
  {
    id: 'pourquoi',
    titre: 'Pourquoi c’est important',
    texte: [
      'Nous vous envoyons des clients. Ensuite, nous devons savoir où vous en êtes : client appelé ? Rendez-vous pris ? Devis parti ? Signé ?',
      'Si vous le notez ici, on n’a plus besoin de vous appeler pour vous le demander.',
      'Vous êtes tranquille, nous aussi, et le client est mieux suivi.',
      'Et soyons clairs : ceux qui tiennent leur espace à jour sont ceux à qui l’on confie le plus de chantiers.',
    ],
  },
  {
    id: 'lien',
    titre: 'Votre lien personnel',
    texte: [
      'Votre espace s’ouvre avec un lien personnel, sans mot de passe : ajoutez-le à l’écran d’accueil de votre téléphone.',
      'Perdu ? On vous le renvoie par email. Et ne le partagez pas : il donne accès à vos clients.',
    ],
  },
  {
    id: 'menu',
    titre: 'Vos rubriques',
    texte: [
      'En bas de l’écran, vous avez vos rubriques : « Chantiers », « Devis », « Entreprise ».',
      'Et « Menu » pour le reste : les métrés, vos commissions, et l’aide.',
      'Sur ordinateur, tout est dans la colonne de gauche.',
    ],
  },
  {
    id: 'tableau',
    titre: 'Vos chiffres en un coup d’œil',
    texte: [
      'En haut de « Mes chantiers », vos chiffres : chiffre d’affaires signé, devis en cours, commission à régler.',
      'Dessous, le bandeau « À traiter » vous dit ce qui attend une action. Touchez « Voir » pour les chantiers concernés.',
    ],
  },
  {
    id: 'liste',
    titre: 'Vos chantiers',
    texte: [
      'Puis la liste de vos chantiers, du plus récent au plus ancien. Cherchez un client, filtrez par étape, ou passez en affichage « Par étape ».',
      'Un nouveau chantier arrive en haut : « Nouveau — à appeler ».',
    ],
  },
  {
    id: 'fiche',
    titre: 'La fiche chantier',
    texte: [
      'Touchez un chantier pour ouvrir sa fiche.',
      'La demande, le budget, les photos, les coordonnées… et le bouton « Appeler » lance l’appel directement.',
    ],
  },
  {
    id: 'avancement',
    titre: 'Le plus important : l’avancement',
    texte: [
      'Et voici le plus important : « Où en êtes-vous ? ».',
      'Après chaque échange avec le client, avancez l’étape : « Client contacté », « RDV pris » avec la date, « Devis envoyé », « Devis signé », « Projet terminé ».',
      'Deux secondes, et c’est exactement ce qu’on vous demanderait au téléphone.',
    ],
  },
  {
    id: 'appels',
    titre: 'Appels, rappels, pause',
    texte: [
      'Le client ne répond pas ? Journal des appels : « Pas de réponse », « Je l’ai eu », « À rappeler ».',
      'Il rentre de vacances le 15 ? « Me le rappeler plus tard » : le chantier garde son étape et remonte dans « À traiter » le jour venu.',
      'Projet en pause ? « En attente ».',
    ],
  },
  {
    id: 'notes',
    titre: 'Un mot plutôt qu’un appel',
    texte: [
      'Dessous, « Une note pour Celexia ? » : écrivez ce qui s’est dit, le besoin, le budget, les hésitations.',
      'Nos réponses arrivent dans « Échanges avec Celexia ». Plutôt qu’un appel, un mot ici suffit.',
    ],
  },
  {
    id: 'devis',
    titre: 'Vos devis',
    texte: [
      'Devis prêt ? Déposez le PDF dans la fiche avec son montant. Client qui signe ? Déposez « Devis signé par le client » : sans lui, le chantier ne peut pas être compté.',
      'Vous pouvez aussi « Créer un devis » ici, et « Mesurer sur la carte » un toit ou un terrain, une fois vos assurances déposées dans « Mon entreprise ».',
    ],
  },
  {
    id: 'retrait',
    titre: 'Un chantier qui ne se fait pas',
    texte: [
      'Pas disponible, ou le client ne donne pas suite ? Ne laissez pas traîner : en bas de la fiche, « Ne pas poursuivre ce chantier », et la raison.',
      'On pourra le confier à un autre artisan, ou relancer le client.',
    ],
  },
  {
    id: 'commissions',
    titre: 'Commissions et entreprise',
    texte: [
      '« Commissions » : chantier par chantier, ce qui est dû et ce qui est réglé. « Mon entreprise » : contrat, informations, assurances.',
    ],
  },
  {
    id: 'reflexes',
    titre: 'Les 3 réflexes',
    texte: [
      'Trois réflexes. Un : appelez chaque nouveau client sous 48 heures.',
      'Deux : après chaque échange, mettez à jour l’étape ou laissez une note.',
      'Trois : déposez vos devis, et le devis signé dès la signature.',
      'Une question ? « Aide et contact ». Merci, et bons chantiers !',
    ],
  },
]
