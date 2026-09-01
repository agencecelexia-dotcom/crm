/**
 * Contenu du business plan — SEULE source de vérité de l'onglet.
 *
 * Extrait de « CELEXIA — Business Plan & SOP v2 (septembre 2026) ». Aucun
 * composant ne contient de texte métier : changer un chiffre ou une ligne se
 * fait ici, et nulle part ailleurs.
 *
 * Le document rédigé complet reste la référence ; cet onglet en est la vue
 * schématique. Quand les deux divergent, c'est le document qui fait foi et ce
 * fichier qu'il faut corriger.
 */

// ---------- Types ----------

/** Santé d'une étape de la chaîne de valeur. */
export type StatutEtape = 'ok' | 'attention' | 'critique'

/** Gravité d'un verrou. `critique` bloque le plan, `moyen` le ralentit. */
export type GraviteVerrou = 'critique' | 'eleve' | 'moyen'

/** Une décision est ouverte tant qu'elle n'est pas arbitrée. */
export type StatutDecision = 'ouvert' | 'tranche'

export interface BusinessPlan {
  meta: { version: string; misAJourLe: string; urlDocument: string }
  identite: { ceQuonFait: string; ambition: string; positionnement: string }
  moat: { rang: number; titre: string; description: string }[]
  machine: { nom: string; sousTitre: string; statut: StatutEtape }[]
  metriques: { label: string; valeur: string; note: string }[]
  pricing: { cas: string; taux: string; note: string }[]
  organisation: { thomas: string[]; antoine: string[]; equipe: string[] }
  capital: {
    repartition: string
    structure: string
    remuneration: string
    vesting: string
  }
  horizons: { horizon: string; objectifs: string[] }[]
  verrous: { titre: string; description: string; gravite: GraviteVerrou }[]
  procedures: { titre: string; etapes: string[] }[]
  stack: { outil: string; role: string; url?: string }[]
  decisionsOuvertes: {
    sujet: string
    question: string
    echeance: string
    statut: StatutDecision
  }[]
  roadmap90j: { pole: string; actions: string[] }[]
}

// ---------- Contenu ----------

export const BUSINESS_PLAN: BusinessPlan = {
  meta: {
    version: 'v2',
    misAJourLe: 'septembre 2026',
    // À remplacer par l'URL du Google Doc : le PDF versionné dans le dépôt ne
    // se met pas à jour tout seul.
    urlDocument: '',
  },

  identite: {
    ceQuonFait:
      'Apporteur d’affaires pour le bâtiment high ticket. Celexia finance et pilote ' +
      'l’acquisition, qualifie la demande, et confie des chantiers prêts à signer à un ' +
      'cercle restreint d’entreprises sélectionnées.',
    ambition:
      'Scaler sans revendre. La boîte doit payer ses fondateurs en dividendes ' +
      'durablement, puis s’exporter. La rentabilité par artisan compte davantage que ' +
      'la croissance brute.',
    positionnement:
      'Chantiers au-dessus de 10 000 € uniquement. Le lead n’est jamais revendu à ' +
      'cinq concurrents — c’est ce qui distingue Celexia des plateformes.',
  },

  moat: [
    {
      rang: 1,
      titre: 'La maîtrise de l’acquisition',
      description: 'Google LSA et Meta, adossés à plusieurs décennales.',
    },
    {
      rang: 2,
      titre: 'Le réseau d’entreprises premium',
      description: 'Structures à forte capacité d’absorption, sélectionnées une par une.',
    },
    {
      rang: 3,
      titre: 'Le discours commercial',
      description: 'La relation artisan et la posture de cercle fermé.',
    },
    {
      rang: 4,
      titre: 'Le CRM maison',
      description: 'Les données de conversion, que personne d’autre ne possède.',
    },
  ],

  machine: [
    {
      nom: 'Publicité',
      sousTitre: 'LSA + Meta · 20 leads/j',
      // Le socle fonctionne, mais la dépendance à Google est notée « forte »
      // au chapitre risques.
      statut: 'attention',
    },
    {
      nom: 'Qualification',
      sousTitre: '4 critères · Shahzaib',
      statut: 'attention',
    },
    {
      nom: 'Dispatch',
      sousTitre: 'Premier arrivé',
      // L'abonnement à 2 000 € et l'attribution au premier arrivé s'excluent.
      statut: 'critique',
    },
    {
      nom: 'Artisan',
      sousTitre: 'Absorption non mesurée',
      statut: 'critique',
    },
    {
      nom: 'Chantier signé',
      sousTitre: 'Taux non mesuré',
      statut: 'attention',
    },
  ],

  metriques: [
    { label: 'Coût moyen d’un lead', valeur: '11,47 €', note: 'Toutes campagnes confondues' },
    { label: 'Volume actuel', valeur: '20 /jour', note: '≈ 600 par mois' },
    { label: 'Budget publicitaire', valeur: '≈ 6 900 €', note: 'Par mois' },
    { label: 'Panier moyen', valeur: '15 000 €', note: 'Fourchette 10 à 25 k€' },
    { label: 'Commission moyenne', valeur: '≈ 3 000 €', note: 'Par chantier, à 20 %' },
    {
      label: 'Taux lead → signé',
      valeur: 'non mesuré',
      note: 'Estimé à ~3 %. Ne pas confondre avec le closing sur devis présenté (~50 %) : un facteur 15 sépare les deux.',
    },
  ],

  pricing: [
    { cas: 'Nouveaux partenaires, France', taux: '20 % HT', note: 'Grille de référence' },
    { cas: 'Batryx, France', taux: '15 % HT', note: 'Tarif historique' },
    { cas: 'Batryx, Suisse', taux: '20 % HT', note: 'Prix ≈ 3× supérieurs' },
    {
      cas: 'Cible à 6 mois',
      taux: '2 000 €/mois + 20 %',
      note: 'Abonnement — reste à définir ce qu’il achète réellement',
    },
  ],

  organisation: {
    thomas: [
      'Campagnes LSA, Meta et budget publicitaire',
      'CRM, développement, statistiques',
      'Comptabilité, facturation, administratif — avec Ingeneo',
      'Juridique et contrats — avec l’avocat',
      'Recouvrement des commissions',
    ],
    antoine: [
      'Recrutement des artisans partenaires — avec Shahzaib',
      'Relation et notation des artisans',
      'Dispatch et réassignation des leads — avec Shahzaib',
      'Appui sur le recouvrement',
    ],
    equipe: [
      'Shahzaib — qualification des leads entrants',
      'Shahzaib — contrôle qualité auprès des particuliers',
      'Shahzaib — cold call artisans, autonomie visée à 30 jours',
      'Objectif 12 mois : 2 à 3 alternants',
    ],
  },

  capital: {
    repartition:
      'Thomas 61 % — Antoine 39 %. L’antériorité de Thomas est intégrée dans l’écart ' +
      'de parts, sans valorisation séparée. Antoine entre par rachat sur un capital ' +
      'de 1 000 €.',
    structure:
      'Passage de la SASU en SAS, co-gérance sans président distinct. Pacte ' +
      'd’associés rédigé avec un avocat, début septembre.',
    remuneration:
      'Aucun salaire associé. Dividendes selon les parts, une à deux fois par an. ' +
      'Seuls les alternants sont salariés. Réinvestissement maximal : on conserve le ' +
      'BFR + 20 à 30 % de marge, 30 à 50 k€ de réserve salaires, et le budget ' +
      'publicitaire du mois. Seul le surplus est distribuable.',
    vesting:
      'Acquisition immédiate et définitive. En cas de départ, rachat des parts sur ' +
      'la base d’une valorisation de la société.',
  },

  horizons: [
    {
      horizon: '3 mois',
      objectifs: [
        '50 k€ de trésorerie',
        'Shahzaib opérationnel',
        '2 à 3 artisans signés',
        'Taux de conversion enfin mesuré',
        'Test massif de formats publicitaires',
      ],
    },
    {
      horizon: '12 mois',
      objectifs: [
        '100 k€ de commissions par mois',
        '50 leads par jour',
        '2 à 3 alternants',
        'Premier cash-out',
        'Suisse lancée',
      ],
    },
    {
      horizon: '3 ans',
      objectifs: [
        'La boîte tourne sans nous',
        'Responsables par pôle',
        'Bureaux, équipe réunie, pas de télétravail',
        'Belgique et Luxembourg',
        'Pas de revente',
      ],
    },
  ],

  verrous: [
    {
      titre: 'Capacité d’absorption non mesurée',
      description:
        'C’est le verrou principal du plan à 12 mois. 100 k€/mois demande ≈ 1 330 leads ' +
        'mensuels ; répartis sur 5 à 10 entreprises, cela fait 130 à 260 demandes par ' +
        'mois chacune — un volume que personne ne devise, même à 34 salariés. Trois ' +
        'issues : bien plus de 10 artisans, un plafond de commissions inférieur, ou ' +
        'mesurer la capacité réelle et recalibrer.',
      gravite: 'critique',
    },
    {
      titre: 'Concentration sur un seul client',
      description:
        'Plus de 90 % du chiffre repose sur Batryx. Objectif : signer 2 à 3 partenaires ' +
        'et passer sous 50 % en six mois.',
      gravite: 'critique',
    },
    {
      titre: 'Trésorerie sous un mois',
      description:
        '50 k€ à atteindre avant toute montée du budget publicitaire. Ouvrir un second ' +
        'marché dans cette situation serait le scénario de risque maximal.',
      gravite: 'critique',
    },
    {
      titre: 'L’offre se contredit',
      description:
        'Un artisan qui paie 2 000 € par mois n’acceptera pas de courir contre d’autres ' +
        'pour attraper un lead. L’abonnement doit ouvrir un droit réel — priorité ' +
        'd’attribution, volume garanti, ou exclusivité par métier — sinon il ne se vend pas.',
      gravite: 'critique',
    },
    {
      titre: 'Dépendance à Google LSA',
      description:
        'Forte. Mitigation : multiplier les décennales pour occuper plusieurs positions, ' +
        'et ouvrir sérieusement Meta.',
      gravite: 'eleve',
    },
    {
      titre: 'Bande passante de Thomas',
      description:
        'Le plan prévoit qu’Antoine tienne seul la boutique pendant les absences. Or la ' +
        'publicité, le CRM et la comptabilité sont exclusivement chez Thomas, sans ' +
        'ressource sous sa colonne. Former Antoine au pilotage publicitaire avant la ' +
        'première absence longue.',
      gravite: 'eleve',
    },
    {
      titre: 'Vesting sans clause de rachat',
      description:
        'Antoine conserverait 39 % à vie en cas de départ précoce, alors qu’il est acté ' +
        'qu’en cas de séparation c’est Thomas qui poursuit seul. Une clause de rachat ' +
        'avant 24 mois neutraliserait ce risque sans rien coûter à Antoine s’il reste.',
      gravite: 'eleve',
    },
    {
      titre: 'Posture artisan contradictoire',
      description:
        '« Ils viennent à nous » s’oppose au fait que le recrutement d’artisans soit le ' +
        'goulot numéro un. Sélectif ne veut pas dire passif : la posture peut rester la ' +
        'même en call tout en allant chercher activement les cibles.',
      gravite: 'moyen',
    },
    {
      titre: 'Ordre de formation de Shahzaib',
      description:
        'Le recrutement d’artisans est le goulot numéro un, mais figure en dernière ' +
        'priorité de sa formation. Décalage à assumer ou à corriger.',
      gravite: 'moyen',
    },
    {
      titre: 'Financement du BFR',
      description:
        'Le prêt bancaire est peu probable dans cette configuration. Le compte courant ' +
        'd’associé est plus rapide et ne touche pas au capital.',
      gravite: 'moyen',
    },
    {
      titre: 'Requalification en agent commercial',
      description:
        'Le contrat doit exclure toute permanence de mandat et tout pouvoir de négocier ' +
        'au nom de l’artisan. Une requalification ouvrirait droit à une indemnité de fin ' +
        'de contrat pouvant atteindre deux ans de commissions.',
      gravite: 'eleve',
    },
  ],

  procedures: [
    {
      titre: 'Traitement d’un lead entrant',
      etapes: [
        'Réception via LSA ou Meta, entrée automatique dans le CRM.',
        'Qualification téléphonique par Shahzaib sur quatre critères : budget confirmé, projet à moins de 3 mois, ticket estimé supérieur à 10 000 €, interlocuteur propriétaire et décisionnaire.',
        'Attribution au premier artisan disponible. Rappel exigé le jour même.',
        'Appel de contrôle qualité au particulier à trois semaines.',
        'Si non transformé : réassignation à un autre artisan.',
      ],
    },
    {
      titre: 'Facturation d’une commission',
      etapes: [
        'L’artisan déclare la signature dans le CRM, avec le montant du chantier et une copie du devis signé.',
        'Vérification du montant hors taxes sur le devis.',
        'Déclenchement à réception de l’acompte par l’artisan.',
        'Émission de la facture depuis Qonto, échéance à 15 jours.',
        'Relance automatique à J+10, mise en demeure à J+15.',
        'Rapprochement de l’encaissement et clôture dans le CRM.',
      ],
    },
    {
      titre: 'Mentions obligatoires sur facture',
      etapes: [
        'Numérotation continue sans trou, date d’émission.',
        'Identité et SIREN des deux parties, numéro de TVA.',
        'Désignation de la prestation d’apport d’affaires, avec référence du chantier.',
        'Montant HT, taux et montant de TVA, total TTC.',
        'Date d’échéance, taux des pénalités de retard, indemnité forfaitaire de recouvrement de 40 €.',
        'Suisse : prestation B2B hors champ de TVA française, autoliquidation par le client, mention à porter sur la facture. Pas de DES à déposer, contrairement à un client belge.',
      ],
    },
    {
      titre: 'Onboarding d’un nouvel artisan',
      etapes: [
        'Signature du contrat.',
        'Formation au CRM.',
        'Premier pack de leads test — environ 50 leads sur un mois, incluant les leads perdus récupérables.',
        'Création ou reprise du compte LSA.',
        'À cadrer dès la signature : l’artisan ne reçoit du volume propre qu’après l’étape 4. Le dire clairement évite la déception au premier mois.',
        'Notation pendant le test : volume absorbé, taux de closing, réactivité, usage du CRM, respect des délais de paiement. Deux artisans maximum par projet pendant cette phase.',
      ],
    },
    {
      titre: 'Shahzaib — autonomie à 30 jours',
      etapes: [
        'Qualifier un lead entrant au téléphone.',
        'Faire les appels de suivi qualité.',
        'Mettre à jour le CRM et relancer les paiements.',
        'Appeler des artisans en cold call.',
      ],
    },
  ],

  stack: [
    {
      outil: 'Google LSA',
      role: 'Socle d’acquisition. Comptes au nom de l’artisan, financés et pilotés par Celexia.',
    },
    { outil: 'Meta Ads', role: 'Second canal, et funnel de candidature artisan.' },
    {
      outil: 'CRM maison',
      role: 'React sur Vercel, base Supabase. Pipeline leads, attribution, suivi chantiers, statistiques.',
    },
    {
      outil: 'Supabase',
      role: 'Base de données et authentification. Source de vérité.',
      url: 'https://supabase.com/dashboard',
    },
    {
      outil: 'Vercel',
      role: 'Hébergement du CRM et des landings, déploiement automatique.',
      url: 'https://vercel.com',
    },
    { outil: 'GitHub', role: 'Code. Chaque merge déclenche un déploiement.' },
    { outil: 'n8n', role: 'Orchestrateur des automatisations.' },
    { outil: 'Qonto', role: 'Compte pro, émission des factures, suivi des encaissements.' },
    { outil: 'Ingeneo', role: 'Cabinet comptable.' },
    { outil: 'Claude', role: 'Développement, analyse, rédaction commerciale et juridique.' },
  ],

  decisionsOuvertes: [
    {
      sujet: 'Capacité d’absorption',
      question: '5-10 artisans ou 50 leads/jour ? Les deux sont incompatibles.',
      echeance: 'Avant la montée du budget pub',
      statut: 'ouvert',
    },
    {
      sujet: 'Offre',
      question: 'Que donne l’abonnement 2 000 € si le lead va au premier arrivé ?',
      echeance: 'Avant le premier call abonnement',
      statut: 'ouvert',
    },
    {
      sujet: 'Suisse',
      question: 'Ouvrir maintenant ou après les 50 k€ ?',
      echeance: 'Septembre',
      statut: 'ouvert',
    },
    {
      sujet: 'Vesting',
      question: 'Clause de rachat avant 24 mois ?',
      echeance: 'RDV avocat, septembre',
      statut: 'ouvert',
    },
    {
      sujet: 'Canal artisan',
      question: 'Quel second canal pour les entreprises structurées ?',
      echeance: 'Septembre',
      statut: 'ouvert',
    },
    {
      sujet: 'Pilotage',
      question: 'Créneau fixe hebdomadaire ou pas ?',
      echeance: 'Septembre',
      statut: 'ouvert',
    },
    {
      sujet: 'Absences Thomas',
      question: 'Qui pilote la publicité ?',
      echeance: 'Avant la première absence',
      statut: 'ouvert',
    },
    {
      sujet: 'Financement du BFR',
      question: 'Prêt bancaire ou compte courant d’associé ?',
      echeance: 'Avant la montée du budget pub',
      statut: 'ouvert',
    },
  ],

  roadmap90j: [
    {
      pole: 'Cash',
      actions: [
        'Recadrer Batryx — devis, CRM, délais de virement',
        'Réduire le délai d’encaissement',
        'Atteindre 50 k€',
      ],
    },
    {
      pole: 'Réseau',
      actions: [
        'Rappeler Idée Confort',
        'Ouvrir un second canal de chasse',
        'Tester un mois par artisan',
      ],
    },
    {
      pole: 'Données',
      actions: [
        'Tracer lead → signature',
        'Lancer l’appel de suivi à 3 semaines',
        'Mesurer l’absorption réelle',
      ],
    },
    {
      pole: 'Structure',
      actions: [
        'Passage en SAS',
        'Pacte d’associés',
        'Réécrire le contrat artisan',
        'Former Antoine à la pub',
      ],
    },
  ],
}
