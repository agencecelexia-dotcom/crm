/**
 * Business Plan Celexia — source de vérité unique de l'onglet BP du CRM.
 *
 * Aucun contenu ne doit être écrit en dur dans les composants : tout vient
 * de ce fichier. Pour mettre à jour un chiffre ou une ligne, modifier ici
 * uniquement, puis incrémenter `meta.version` et `meta.miseAJour`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Statut = "ok" | "attention" | "critique";
export type Gravite = "critique" | "eleve" | "moyen";
export type StatutDecision = "ouvert" | "tranche";
export type Perimetre = "thomas" | "antoine" | "equipe" | "commun";

export interface Meta {
  version: string;
  miseAJour: string;
  docUrl: string;
}

export interface Identite {
  ceQuonFait: string;
  ambition: string;
  positionnement: string;
}

export interface MoatItem {
  rang: number;
  titre: string;
  description: string;
}

export interface EtapeMachine {
  nom: string;
  sousTitre: string;
  statut: Statut;
  perimetre: Perimetre;
}

export interface Metrique {
  label: string;
  valeur: string;
  note?: string;
}

export interface LignePricing {
  cas: string;
  taux: string;
  note?: string;
}

export interface Organisation {
  thomas: string[];
  antoine: string[];
  equipe: string[];
}

export interface Capital {
  repartition: string;
  structure: string;
  remuneration: string;
  vesting: string;
  reserve?: string;
}

export interface Horizon {
  horizon: string;
  objectifs: string[];
}

export interface Verrou {
  titre: string;
  description: string;
  gravite: Gravite;
}

export interface Procedure {
  titre: string;
  etapes: string[];
  note?: string;
}

export interface OutilStack {
  outil: string;
  role: string;
  url?: string;
  perimetre: Perimetre;
}

export interface DecisionOuverte {
  sujet: string;
  question: string;
  echeance: string;
  statut: StatutDecision;
}

export interface PoleRoadmap {
  pole: string;
  actions: string[];
}

export interface BusinessPlan {
  meta: Meta;
  identite: Identite;
  moat: MoatItem[];
  machine: EtapeMachine[];
  metriques: Metrique[];
  pricing: LignePricing[];
  organisation: Organisation;
  capital: Capital;
  horizons: Horizon[];
  verrous: Verrou[];
  procedures: Procedure[];
  stack: OutilStack[];
  decisionsOuvertes: DecisionOuverte[];
  roadmap90j: PoleRoadmap[];
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

export const businessPlan: BusinessPlan = {
  meta: {
    version: "v2",
    miseAJour: "2026-09-01",
    docUrl:
      "https://docs.google.com/document/d/1igLutgCQZJNvG2vzR9kCet05wedFCsEjXrJjDHfaTzQ/edit",
  },

  identite: {
    ceQuonFait:
      "Apporteur d'affaires pour le bâtiment high ticket. Celexia finance et pilote l'acquisition, qualifie la demande, et confie des chantiers prêts à signer à un cercle restreint d'entreprises sélectionnées. Chantiers au-dessus de 10 000 € uniquement.",
    ambition:
      "Scaler sans revendre. La boîte doit payer ses fondateurs en dividendes durablement, puis s'exporter. La rentabilité par artisan compte donc davantage que la croissance brute.",
    positionnement:
      "Ni une agence payée qu'elle performe ou non, ni une plateforme qui revend le même lead à cinq concurrents. Cercle fermé, sélection annuelle, bilan à 3 mois, éviction à 6 mois si les objectifs ne sont pas tenus.",
  },

  moat: [
    {
      rang: 1,
      titre: "Maîtrise de l'acquisition",
      description: "LSA, Meta, multi-décennales. C'est là que va l'argent en priorité.",
    },
    {
      rang: 2,
      titre: "Réseau premium",
      description: "Entreprises structurées à forte capacité d'absorption.",
    },
    {
      rang: 3,
      titre: "Relation artisan",
      description: "Discours commercial et confiance dans la durée.",
    },
    {
      rang: 4,
      titre: "CRM maison",
      description: "Données de conversion propriétaires, métier par métier.",
    },
  ],

  machine: [
    { nom: "Publicité", sousTitre: "LSA et Meta", statut: "ok", perimetre: "thomas" },
    { nom: "Qualification", sousTitre: "4 critères cumulés", statut: "ok", perimetre: "equipe" },
    { nom: "Dispatch", sousTitre: "Premier arrivé", statut: "attention", perimetre: "antoine" },
    { nom: "Artisan", sousTitre: "Goulot actuel", statut: "critique", perimetre: "antoine" },
    {
      nom: "Chantier signé",
      sousTitre: "Commission à l'acompte",
      statut: "ok",
      perimetre: "thomas",
    },
  ],

  metriques: [
    { label: "Coût du lead", valeur: "11,47 €" },
    { label: "Volume actuel", valeur: "20 / jour", note: "≈ 600 leads par mois" },
    { label: "Budget pub mensuel", valeur: "≈ 6 900 €" },
    { label: "Panier moyen chantier", valeur: "15 000 €", note: "Fourchette 10 à 25 k€" },
    { label: "Commission moyenne", valeur: "≈ 3 000 €", note: "Base 20 % sur 15 k€" },
    {
      label: "Taux lead → chantier",
      valeur: "non mesuré",
      note: "Estimé à 3 %. Ne pas confondre avec le closing sur devis présenté (≈ 50 %) : un facteur 15 sépare les deux.",
    },
  ],

  pricing: [
    {
      cas: "Nouveaux partenaires, France",
      taux: "20 % HT",
      note: "Dû à réception de l'acompte, échéance 15 jours",
    },
    { cas: "Batrix, France", taux: "15 % HT", note: "Tarif historique" },
    {
      cas: "Batrix, Suisse",
      taux: "20 % HT",
      note: "Hors champ de TVA française, autoliquidation client",
    },
    {
      cas: "Cible à 6 mois",
      taux: "2 000 €/mois + 20 %",
      note: "Modèle mixte. Contrepartie de l'abonnement encore à définir.",
    },
  ],

  organisation: {
    thomas: [
      "Campagnes LSA, Meta et budget publicitaire",
      "CRM, développement, statistiques",
      "Comptabilité, facturation, administratif",
      "Juridique et contrats",
      "Recouvrement des commissions",
    ],
    antoine: [
      "Recrutement des artisans partenaires",
      "Relation et notation des artisans",
      "Dispatch et réassignation des leads",
      "Stratégies de closing",
      "Contrôle qualité",
    ],
    equipe: [
      "Shahzaib — qualification des leads entrants",
      "Shahzaib — appels de suivi qualité",
      "Shahzaib — mise à jour CRM et relances de paiement",
      "2e alternant commercial à recruter",
    ],
  },

  capital: {
    repartition: "Thomas 61 % — Antoine 39 %",
    structure:
      "Passage de la SASU en SAS, co-gérance sans président distinct, pacte d'associés chez l'avocat.",
    remuneration:
      "Aucun salaire associé. Dividendes selon les parts, une à deux fois par an. Seuls les alternants sont salariés.",
    vesting:
      "Acquisition immédiate et définitive. En cas de départ, rachat des parts sur valorisation de la société.",
    reserve:
      "Antoine conserverait 39 % à vie en cas de départ précoce, alors qu'il est acté qu'en cas de séparation c'est Thomas qui poursuit seul. Une clause de rachat avant 24 mois neutraliserait ce risque sans rien coûter à Antoine s'il reste.",
  },

  horizons: [
    {
      horizon: "3 mois",
      objectifs: [
        "50 k€ de trésorerie constitués",
        "Shahzaib pleinement opérationnel",
        "2 à 3 artisans signés hors Batrix",
        "Taux de conversion enfin mesuré",
        "Test massif de formats publicitaires",
      ],
    },
    {
      horizon: "12 mois",
      objectifs: [
        "100 k€ de commissions encaissées par mois",
        "50 leads par jour",
        "2 à 3 alternants en poste",
        "Premier cash-out de 20 à 40 k€ chacun",
        "Suisse lancée",
        "La boîte tourne sans nous sur chaque affaire",
      ],
    },
    {
      horizon: "3 ans",
      objectifs: [
        "Responsables par pôle",
        "Bureaux, équipe réunie, pas de télétravail",
        "Belgique et Luxembourg",
        "Pas de revente",
      ],
    },
  ],

  verrous: [
    {
      titre: "Concentration client",
      description:
        "Plus de 90 % du chiffre repose sur Batrix. Objectif : passer sous 50 % en six mois en signant 2 à 3 partenaires.",
      gravite: "critique",
    },
    {
      titre: "Trésorerie",
      description:
        "Moins d'un mois de couverture. Le modèle avance la publicité avant d'encaisser : monter le budget dans cet état agrandit le trou. 50 k€ avant toute montée.",
      gravite: "critique",
    },
    {
      titre: "Capacité d'absorption",
      description:
        "L'objectif de 100 k€/mois demande ≈ 1 330 leads mensuels. Répartis sur 5 à 10 entreprises, cela fait 130 à 260 devis chacune. Personne ne tient ce rythme.",
      gravite: "eleve",
    },
    {
      titre: "Cohérence de l'offre",
      description:
        "Un abonnement fixe à 2 000 € et un lead attribué au premier arrivé s'excluent. Il faut définir ce que l'artisan achète réellement.",
      gravite: "eleve",
    },
    {
      titre: "Canal de recrutement unique",
      description:
        "Le funnel Meta attire des artisans isolés, pas des entreprises de trente salariés. Un second canal de chasse est nécessaire.",
      gravite: "eleve",
    },
    {
      titre: "Dépendance Google LSA",
      description:
        "Mitigation en cours : multiplication des décennales, ouverture de Meta, diversification progressive.",
      gravite: "moyen",
    },
    {
      titre: "Bande passante Thomas",
      description:
        "L3, réserve et Datavocat en parallèle. Antoine doit être formé au pilotage publicitaire avant la première absence longue.",
      gravite: "moyen",
    },
    {
      titre: "Financement du BFR",
      description:
        "Le prêt bancaire est peu probable avec moins d'un mois de trésorerie et 90 % du CA sur un client. Le compte courant d'associé est plus rapide et ne touche pas au capital.",
      gravite: "moyen",
    },
  ],

  procedures: [
    {
      titre: "Traitement d'un lead entrant",
      etapes: [
        "Réception via LSA ou Meta, entrée automatique dans le CRM",
        "Qualification téléphonique : budget confirmé, projet à moins de 3 mois, ticket estimé supérieur à 10 000 €, interlocuteur propriétaire et décisionnaire",
        "Attribution au premier artisan disponible, rappel exigé le jour même",
        "Appel de contrôle qualité au particulier à trois semaines",
        "Si non transformé, réassignation à un autre artisan",
      ],
    },
    {
      titre: "Facturation d'une commission",
      etapes: [
        "L'artisan déclare la signature et fournit le montant du chantier et une copie du devis signé",
        "Vérification du montant hors taxes sur le devis",
        "Déclenchement à réception de l'acompte par l'artisan",
        "Émission de la facture depuis Qonto, échéance à 15 jours",
        "Relance automatique à J+10, mise en demeure à J+15",
        "Rapprochement de l'encaissement et clôture de la ligne dans le CRM",
      ],
      note: "Mentions obligatoires : numérotation continue sans trou, date d'émission, identité et SIREN des deux parties, numéro de TVA, désignation de la prestation d'apport d'affaires avec référence du chantier, montant HT, taux et montant de TVA, total TTC, date d'échéance, taux des pénalités de retard, indemnité forfaitaire de recouvrement de 40 €. Pour la Suisse, mention d'autoliquidation par le client.",
    },
    {
      titre: "Onboarding d'un nouvel artisan",
      etapes: [
        "Signature du contrat",
        "Formation au CRM",
        "Premier pack de leads test, environ 50 leads sur un mois",
        "Création ou reprise du compte LSA",
      ],
      note: "Cadrer dès la signature que le volume propre n'arrive qu'après l'étape 4 : le pack de test provient de campagnes déjà en route. Notation pendant le test sur volume absorbé, closing, réactivité, usage du CRM, respect des délais de paiement.",
    },
    {
      titre: "Rituels de pilotage",
      etapes: [
        "KPI hebdomadaires tenus par Thomas : leads entrants, montant moyen des devis, taux de conversion, chantiers réassignés, chantiers récupérés et commissionnés",
        "Appel de contrôle qualité au particulier à trois semaines",
        "Notation mensuelle de chaque artisan du cercle",
        "Revue mensuelle chiffrée à deux",
      ],
      note: "Aucun créneau fixe n'est instauré aujourd'hui. Se parler quotidiennement relève de l'opérationnel : sans revue chiffrée, une dérive ne se voit qu'une fois installée.",
    },
  ],

  stack: [
    {
      outil: "Google LSA",
      role: "Socle d'acquisition. Comptes au nom de l'artisan, financés et pilotés par Celexia. Multiplier les décennales permet d'occuper plusieurs positions sur un même prospect.",
      url: "https://ads.google.com/local-services-ads/",
      perimetre: "thomas",
    },
    {
      outil: "Meta Ads",
      role: "Second canal d'acquisition et funnel de candidature artisan.",
      url: "https://business.facebook.com/",
      perimetre: "thomas",
    },
    {
      outil: "CRM maison",
      role: "React sur Vercel, base Supabase. Pipeline leads, attribution artisan, suivi des chantiers, statistiques.",
      perimetre: "thomas",
    },
    {
      outil: "Supabase",
      role: "Base de données et authentification. Source de vérité des leads, artisans, chantiers et commissions.",
      url: "https://supabase.com/dashboard",
      perimetre: "thomas",
    },
    {
      outil: "Vercel",
      role: "Hébergement du CRM et des landing pages, déploiement automatique à chaque push.",
      url: "https://vercel.com/dashboard",
      perimetre: "thomas",
    },
    {
      outil: "GitHub",
      role: "Code du CRM et des landings.",
      url: "https://github.com",
      perimetre: "thomas",
    },
    {
      outil: "n8n",
      role: "Orchestrateur des automatisations : routage des leads, notifications, relances.",
      url: "https://n8n.io",
      perimetre: "thomas",
    },
    {
      outil: "Qonto",
      role: "Compte pro, émission des factures, suivi des encaissements. Second compte à ouvrir pour la réserve salaires.",
      url: "https://app.qonto.com",
      perimetre: "thomas",
    },
    {
      outil: "Ingeneo",
      role: "Cabinet comptable. Externalisation progressive de la compta à mesure que le volume monte.",
      perimetre: "thomas",
    },
    {
      outil: "Claude",
      role: "Développement, analyse, rédaction commerciale et juridique, structuration.",
      url: "https://claude.ai",
      perimetre: "commun",
    },
  ],

  decisionsOuvertes: [
    {
      sujet: "Capacité d'absorption",
      question:
        "5 à 10 artisans ou 50 leads par jour ? Les deux objectifs sont incompatibles en l'état.",
      echeance: "Avant toute montée du budget publicitaire",
      statut: "ouvert",
    },
    {
      sujet: "Offre",
      question:
        "Que donne concrètement l'abonnement à 2 000 € si le lead va au premier arrivé ?",
      echeance: "Avant le premier call abonnement",
      statut: "ouvert",
    },
    {
      sujet: "Suisse",
      question: "Ouvrir maintenant, ou après le palier de 50 k€ de trésorerie ?",
      echeance: "Septembre 2026",
      statut: "ouvert",
    },
    {
      sujet: "Vesting",
      question: "Ajouter une clause de rachat en cas de départ avant 24 mois ?",
      echeance: "RDV avocat, septembre 2026",
      statut: "ouvert",
    },
    {
      sujet: "Canal artisan",
      question:
        "Quel second canal pour chasser les entreprises structurées que le funnel Meta n'atteint pas ?",
      echeance: "Septembre 2026",
      statut: "ouvert",
    },
    {
      sujet: "Pilotage",
      question: "Instaurer un créneau fixe hebdomadaire, ou rester en à la demande ?",
      echeance: "Septembre 2026",
      statut: "ouvert",
    },
    {
      sujet: "Absences Thomas",
      question: "Qui pilote les campagnes publicitaires pendant les absences longues ?",
      echeance: "Avant la première absence",
      statut: "ouvert",
    },
    {
      sujet: "Financement du BFR",
      question: "Prêt bancaire, ou compte courant d'associé ?",
      echeance: "Avant la montée du budget publicitaire",
      statut: "ouvert",
    },
    {
      sujet: "Séquence cash",
      question: "Trésorerie de 50 k€ avant le cash-out.",
      echeance: "Tranché",
      statut: "tranche",
    },
    {
      sujet: "Dispatch",
      question:
        "Exclusivité sur le lead lui-même, premier arrivé. Mise en concurrence au-dessus de 50 000 €.",
      echeance: "Tranché",
      statut: "tranche",
    },
    {
      sujet: "Répartition du capital",
      question: "Thomas 61 %, Antoine 39 %, parts acquises immédiatement.",
      echeance: "Tranché",
      statut: "tranche",
    },
  ],

  roadmap90j: [
    {
      pole: "Cash",
      actions: [
        "Recadrer Batrix : devis en attente, mise à jour du CRM, respect du délai de virement",
        "Réduire le délai d'encaissement des commissions",
        "Atteindre 50 k€ de trésorerie",
      ],
    },
    {
      pole: "Réseau",
      actions: [
        "Rappeler Idée Confort et proposer un test sur les leads perdus",
        "Ouvrir un second canal de chasse d'entreprises structurées",
        "Lancer une phase de test d'un mois par artisan",
      ],
    },
    {
      pole: "Données",
      actions: [
        "Tracer le taux lead → devis → signature par artisan",
        "Mettre en place l'appel de suivi particulier à trois semaines",
        "Mesurer la capacité d'absorption réelle d'un partenaire",
      ],
    },
    {
      pole: "Structure",
      actions: [
        "Passage de la SASU en SAS",
        "Pacte d'associés chez l'avocat",
        "Réécrire le contrat d'apport d'affaires",
        "Former Antoine au pilotage publicitaire",
      ],
    },
  ],
};

export default businessPlan;
