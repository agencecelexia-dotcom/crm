/**
 * Catalogue de TOUTES les automatisations du CRM.
 *
 * Règle : toute automatisation ajoutée au CRM — déclencheur base, tâche
 * planifiée, webhook n8n, envoi d'e-mail — doit avoir son entrée ici. C'est
 * cette liste qui donne le contrôle et, tout aussi important, la visibilité :
 * une automatisation absente de cet écran est une automatisation subie.
 *
 * `cle` correspond à une ligne de `app_settings`, lue en base par
 * `automatisation_active()` (migration 0107). L'interrupteur coupe donc
 * réellement l'automatisation — il n'est pas décoratif.
 */

export type FamilleAutomatisation =
  | 'planifie'
  | 'notif_interne'
  | 'mail_externe'
  | 'relance'

export interface FamilleInfo {
  titre: string
  description: string
  couleur: string
}

export const FAMILLES: Record<FamilleAutomatisation, FamilleInfo> = {
  relance: {
    titre: 'Relances',
    description: 'Emails et alertes déclenchés par l’inaction sur un chantier.',
    couleur: '#8B5CF6',
  },
  planifie: {
    titre: 'Tâches planifiées',
    description: 'Traitements récurrents exécutés par la base à heure fixe.',
    couleur: '#0F766E',
  },
  notif_interne: {
    titre: 'Notifications internes',
    description: 'Ce que l’agence reçoit quand un événement survient.',
    couleur: '#3B82F6',
  },
  mail_externe: {
    titre: 'E-mails externes',
    description: 'Ce qui part vers un artisan ou un client.',
    couleur: '#F59E0B',
  },
}

export interface Automatisation {
  cle: string
  famille: FamilleAutomatisation
  titre: string
  /** Ce que ça fait, en clair. Pas de jargon technique. */
  description: string
  /** Ce qui la déclenche, pour situer le moment. */
  declencheur: string
  /**
   * Vrai quand l'interrupteur n'est pas encore câblé côté base. Affiché
   * explicitement plutôt que masqué : mieux vaut savoir qu'une automatisation
   * tourne sans pouvoir être coupée que de l'ignorer.
   */
  lectureSeule?: boolean
}

export const AUTOMATISATIONS: Automatisation[] = [
  // ---- Relances ------------------------------------------------------
  {
    cle: 'auto_contrat',
    famille: 'relance',
    titre: 'Relance contrat non signé',
    description: 'Relance l’artisan tant qu’il n’a pas signé son contrat, puis alerte l’agence.',
    declencheur: 'Contrat envoyé et non signé au bout du délai réglé',
  },
  {
    cle: 'auto_inaction',
    famille: 'relance',
    titre: 'Relance chantier sans nouvelle',
    description: 'Relance l’artisan qui n’a pas donné suite sur un chantier attribué.',
    declencheur: 'Aucun suivi enregistré depuis le délai réglé',
  },
  {
    cle: 'auto_post_rdv',
    famille: 'relance',
    titre: 'Relance après rendez-vous',
    description: 'Demande à l’artisan le compte rendu de sa visite et le devis.',
    declencheur: 'Rendez-vous passé sans devis déposé',
  },
  {
    cle: 'auto_orphelin',
    famille: 'relance',
    titre: 'Digest des leads non attribués',
    description: 'Récapitulatif des chantiers qui n’ont encore été confiés à personne.',
    declencheur: 'Chaque passage des relances',
  },

  // ---- Tâches planifiées ---------------------------------------------
  {
    cle: 'auto_taches',
    famille: 'planifie',
    titre: 'Rafraîchissement des tâches',
    description: 'Recalcule la liste des tâches du jour et leurs échéances.',
    declencheur: 'Toutes les 30 minutes',
  },
  {
    cle: 'auto_rappels',
    famille: 'planifie',
    titre: 'Envoi des rappels programmés',
    description: 'Envoie les rappels dont l’heure est arrivée.',
    declencheur: 'Toutes les 5 minutes',
  },
  {
    cle: 'auto_recontacts',
    famille: 'planifie',
    titre: 'Recontacts du jour',
    description: 'Sort les clients à rappeler dont la date de recontact est atteinte.',
    declencheur: 'Chaque jour à 7 h',
  },
  {
    cle: 'pont_crm_artisan',
    famille: 'planifie',
    titre: 'Pont vers le CRM des artisans',
    description:
      'Pousse chaque attribution, retrait et message vers le CRM propre de l’artisan, et rapatrie ses mises à jour. Se règle artisan par artisan depuis sa fiche ; cet interrupteur coupe TOUS les ponts d’un coup.',
    declencheur: 'À chaque événement, livré dans la minute',
  },
  {
    cle: 'auto_coherence',
    famille: 'planifie',
    titre: 'Contrôle de cohérence',
    description:
      'Vérifie chaque nuit que les montants, statuts et commissions concordent, et signale les écarts.',
    declencheur: 'Chaque jour à 7 h',
  },

  // ---- Notifications internes ----------------------------------------
  {
    cle: 'auto_notif_assignation',
    famille: 'notif_interne',
    titre: 'Chantier attribué',
    description: 'Prévient quand un chantier est confié à un artisan.',
    declencheur: 'Attribution d’un chantier',
  },
  {
    cle: 'auto_notif_inscription',
    famille: 'notif_interne',
    titre: 'Nouvel artisan inscrit',
    description: 'Prévient quand un artisan s’inscrit via un lien public.',
    declencheur: 'Inscription depuis /rejoindre',
  },
  {
    cle: 'auto_notif_contrat',
    famille: 'notif_interne',
    titre: 'Contrat signé',
    description: 'Prévient dès qu’un artisan signe son contrat de partenariat.',
    declencheur: 'Signature électronique validée',
  },
  {
    cle: 'auto_notif_devis',
    famille: 'notif_interne',
    titre: 'Devis déposé',
    description: 'Prévient quand un artisan dépose un devis sur son espace.',
    declencheur: 'Dépôt d’un devis',
  },
  {
    cle: 'auto_notif_suivi',
    famille: 'notif_interne',
    titre: 'Suivi ajouté par un artisan',
    description: 'Prévient quand un artisan écrit un suivi depuis son espace.',
    declencheur: 'Suivi enregistré via un lien artisan',
    lectureSeule: true,
  },
  {
    cle: 'auto_notif_retrait',
    famille: 'notif_interne',
    titre: 'Chantier rendu par un artisan',
    description: 'Prévient quand un artisan se retire d’un chantier, avec son motif.',
    declencheur: 'Retrait depuis l’espace artisan',
    lectureSeule: true,
  },
  {
    cle: 'auto_notif_perdu',
    famille: 'notif_interne',
    titre: 'Chantier perdu',
    description: 'Alerte pour reprise et réattribution rapide du chantier.',
    declencheur: 'Chantier marqué perdu',
    lectureSeule: true,
  },

  // ---- E-mails externes -----------------------------------------------
  {
    cle: 'auto_mail_invitation',
    famille: 'mail_externe',
    titre: 'Invitation d’un commercial',
    description: 'Envoie le lien de création de mot de passe à un commercial invité.',
    declencheur: 'Invitation depuis la page Équipe',
    lectureSeule: true,
  },
]
