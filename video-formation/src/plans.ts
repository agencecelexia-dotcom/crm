import type { IdPartie } from './script'

/**
 * STORYBOARD — ce que montre chaque partie.
 *
 * `mot` : l'écran ou la mise en valeur apparaît quand ce mot est prononcé
 * (il doit figurer tel quel dans le texte de la partie, src/script.ts).
 * `boite` : élément repéré lors de la capture (public/captures/boites.json).
 */
export type Marque = { boite: string; mot?: string; legende?: string; tap?: boolean }
export type Plan = {
  capture: string
  mot?: string
  /** Zoom sur un élément ; absent = écran entier. */
  zoom?: string
  marques?: Marque[]
  /** Capture d'ordinateur (paysage) au lieu du téléphone. */
  ordinateur?: boolean
}
export type Scene =
  | { type: 'telephone'; plans: Plan[] }
  | { type: 'bienvenue' | 'pourquoi' | 'lien' | 'reflexes' }

export const SCENES: Record<IdPartie, Scene> = {
  bienvenue: { type: 'bienvenue' },
  pourquoi: { type: 'pourquoi' },
  lien: { type: 'lien' },
  menu: {
    type: 'telephone',
    plans: [
      {
        capture: 'accueil',
        marques: [
          { boite: 'barre', mot: 'En bas' },
          { boite: 'navChantiers', mot: '« Chantiers »', legende: 'Vos chantiers' },
          { boite: 'navDevis', mot: '« Devis »', legende: 'Vos devis' },
          { boite: 'navEntreprise', mot: '« Entreprise »', legende: 'Contrat et assurances' },
          { boite: 'navMenu', mot: '« Menu »', tap: true },
        ],
      },
      {
        capture: 'menu',
        mot: 'pour le reste',
        marques: [
          { boite: 'metres', mot: 'les métrés' },
          { boite: 'commissions', mot: 'vos commissions' },
          { boite: 'aide', mot: 'l’aide' },
        ],
      },
      { capture: 'ordinateur', mot: 'Sur ordinateur', ordinateur: true },
    ],
  },
  tableau: {
    type: 'telephone',
    plans: [
      {
        capture: 'accueil',
        zoom: 'tuiles',
        marques: [{ boite: 'tuiles', mot: 'vos chiffres' }],
      },
      {
        capture: 'accueil',
        mot: 'Dessous',
        zoom: 'aTraiter',
        marques: [
          { boite: 'aTraiter', mot: '« À traiter »', legende: 'Ce qui vous attend' },
          { boite: 'voir', mot: 'Touchez', tap: true },
        ],
      },
    ],
  },
  liste: {
    type: 'telephone',
    plans: [
      {
        capture: 'liste',
        marques: [
          { boite: 'recherche', mot: 'Cherchez' },
          { boite: 'filtres', mot: 'filtrez' },
          { boite: 'parEtape', mot: 'passez en affichage', tap: true },
        ],
      },
      { capture: 'kanban', mot: '« Par étape »' },
      {
        capture: 'liste',
        mot: 'Un nouveau chantier',
        zoom: 'premiere',
        marques: [{ boite: 'nouveau', mot: '« Nouveau', legende: 'À appeler vite' }],
      },
    ],
  },
  fiche: {
    type: 'telephone',
    plans: [
      { capture: 'liste', marques: [{ boite: 'premiere', mot: 'Touchez', tap: true }] },
      {
        capture: 'fiche-haut',
        mot: 'La demande',
        marques: [
          { boite: 'demande', mot: 'La demande' },
          { boite: 'appeler', mot: '« Appeler »', tap: true, legende: 'Un toucher, c’est appelé' },
        ],
      },
    ],
  },
  avancement: {
    type: 'telephone',
    plans: [
      {
        capture: 'fiche-avancement',
        marques: [
          { boite: 'titre', mot: '« Où en êtes-vous ? »' },
          { boite: 'parcours', mot: 'avancez l’étape' },
          { boite: 'contacte', mot: '« Client contacté »', legende: '1' },
          { boite: 'rdv', mot: '« RDV pris »', legende: '2 · avec la date' },
          { boite: 'devisEnvoye', mot: '« Devis envoyé »', legende: '3' },
          { boite: 'devisSigne', mot: '« Devis signé »', legende: '4' },
          { boite: 'termine', mot: '« Projet terminé »', legende: '5' },
        ],
      },
      {
        capture: 'fiche-contacte',
        mot: 'Deux secondes',
        marques: [
          { boite: 'contacte', mot: 'Deux secondes', tap: true },
          { boite: 'merci', mot: 'exactement', legende: 'Celexia est informé' },
        ],
      },
    ],
  },
  appels: {
    type: 'telephone',
    plans: [
      {
        capture: 'fiche-appels',
        zoom: 'journal',
        marques: [
          { boite: 'pasDeReponse', mot: '« Pas de réponse »', tap: true },
          { boite: 'jeLaiEu', mot: '« Je l’ai eu »' },
          { boite: 'aRappeler', mot: '« À rappeler »' },
        ],
      },
      {
        capture: 'fiche-appels',
        mot: 'Il rentre',
        marques: [
          { boite: 'rappel', mot: '« Me le rappeler plus tard »', legende: 'L’étape ne bouge pas' },
          { boite: 'enAttente', mot: '« En attente »', legende: 'Projet en pause' },
        ],
      },
    ],
  },
  notes: {
    type: 'telephone',
    plans: [
      {
        capture: 'fiche-notes',
        marques: [
          { boite: 'note', mot: '« Une note pour Celexia ? »' },
          { boite: 'envoyer', mot: 'les hésitations', tap: true },
          { boite: 'echanges', mot: '« Échanges avec Celexia »', legende: 'Nos réponses' },
        ],
      },
    ],
  },
  devis: {
    type: 'telephone',
    plans: [
      {
        capture: 'fiche-documents',
        marques: [
          { boite: 'devis', mot: 'Déposez le PDF', legende: 'PDF + montant' },
          { boite: 'devisSigne', mot: '« Devis signé par le client »', legende: 'Indispensable' },
          { boite: 'creer', mot: '« Créer un devis »' },
          { boite: 'mesurer', mot: '« Mesurer sur la carte »' },
        ],
      },
      { capture: 'entreprise', mot: '« Mon entreprise »' },
    ],
  },
  retrait: {
    type: 'telephone',
    plans: [
      { capture: 'fiche-retrait', marques: [{ boite: 'retrait', mot: '« Ne pas poursuivre ce chantier »', tap: true }] },
      { capture: 'retrait-dialogue', mot: 'et la raison', marques: [{ boite: 'dialogue', mot: 'et la raison' }] },
    ],
  },
  commissions: {
    type: 'telephone',
    plans: [
      { capture: 'commissions' },
      { capture: 'entreprise', mot: '« Mon entreprise »' },
    ],
  },
  reflexes: { type: 'reflexes' },
}
