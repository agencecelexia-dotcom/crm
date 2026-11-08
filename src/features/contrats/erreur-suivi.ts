/** Codes publics maîtrisés ; ne jamais afficher une erreur SQL brute au client. */
const MESSAGES: Record<string, string> = {
  contrat_requis: 'Signez votre contrat de partenariat pour mettre à jour ce chantier.',
  artisan_ecarte: 'Cet espace n’est plus actif. Contactez Celexia.',
  chantier_retire: 'Ce chantier a été retiré. Retrouvez-le dans vos chantiers perdus.',
  projet_clos: 'Ce chantier est clôturé. Contactez Celexia.',
  token_invalide: 'Ce chantier n’est plus accessible. Actualisez votre espace.',
  introuvable: 'Ce chantier n’est plus accessible. Actualisez votre espace.',
  devis_signe_depose: 'Un devis signé est déjà déposé. Contactez Celexia pour corriger ce chantier.',
  commission_encaissee: 'La commission est déjà réglée. Contactez Celexia pour corriger ce chantier.',
  affaire_signee: 'Ce chantier est signé. Contactez Celexia pour l’annuler.',
  motif_requis: 'Précisez la raison de la perte du chantier.',
  motif_non_autorise: 'Choisissez un motif de perte côté client. Pour refuser ce chantier, utilisez « Me retirer de ce chantier ».',
  justification_requise: 'Précisez la situation en au moins 5 caractères.',
  cle_requise: 'Actualisez votre espace avant de réessayer cet enregistrement.',
  idempotence_conflit: 'Cette tentative correspond déjà à un autre enregistrement. Actualisez votre espace avant de réessayer.',
  PGRST202: 'Le suivi est temporairement indisponible. Vos saisies sont conservées ; réessayez plus tard.',
  date_passee: 'Choisissez une date à venir.',
  date_rdv_requise: 'Choisissez la date du rendez-vous.',
  statut_non_autorise: 'Cette étape n’est pas disponible.',
}

export function messageErreurSuivi(erreur: unknown, fallback = "Impossible d'enregistrer"): string {
  if (typeof erreur === 'string') return MESSAGES[erreur] ?? MESSAGES[erreur.split('abandon_refuse:')[1]] ?? fallback
  if (erreur && typeof erreur === 'object') {
    const e = erreur as { error?: unknown; message?: unknown; code?: unknown }
    if (typeof e.error === 'string' && MESSAGES[e.error]) return MESSAGES[e.error]
    if (typeof e.code === 'string' && MESSAGES[e.code]) return MESSAGES[e.code]
    if (typeof e.message === 'string') return messageErreurSuivi(e.message, fallback)
  }
  return fallback
}
