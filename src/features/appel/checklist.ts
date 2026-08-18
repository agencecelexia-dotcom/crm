/**
 * Checklist d'un appel : ce qu'il reste à demander avant de raccrocher.
 *
 * Le principe est l'inverse d'un formulaire. Un formulaire montre des cases à
 * remplir après coup ; la checklist montre les QUESTIONS À POSER pendant que
 * le client est encore en ligne. Un champ disparaît de la liste dès que
 * l'information est captée avec assez de certitude.
 */

/** Seuil au-dessus duquel un champ est considéré comme acquis. En dessous, il
 *  reste affiché « à confirmer » avec la valeur proposée : la transcription
 *  vient d'un haut-parleur, les chiffres y sont régulièrement mal reconnus. */
export const SEUIL_CONFIANCE = 0.75

export interface LeadExtrait {
  client_nom?: string
  client_telephone?: string
  client_email?: string
  client_adresse?: string
  client_code_postal?: string
  client_ville?: string
  metiers?: string[]
  probleme?: string
  surface?: string
  sinistre?: string
  assurance?: string
  delai?: string
  budget?: string
  disponibilite?: string
  contraintes?: string[]
  alertes?: string[]
  confiance?: Record<string, number>
}

export type EtatChamp = 'obtenu' | 'a_confirmer' | 'manquant'

export interface LigneChecklist {
  cle: keyof LeadExtrait
  /** Libellé court, colonne de gauche. */
  label: string
  /** Formulé comme une question à poser au client. */
  question: string
  etat: EtatChamp
  valeur: string
  /** Un champ non essentiel ne bloque pas la fin d'appel. */
  essentiel: boolean
}

interface Definition {
  cle: keyof LeadExtrait
  label: string
  question: string
  essentiel: boolean
  /** Champ conditionnel : n'apparaît que si le contexte le justifie. */
  pertinent?: (l: LeadExtrait) => boolean
}

const DEFINITIONS: Definition[] = [
  { cle: 'client_nom', label: 'Nom', question: 'Quel est votre nom ?', essentiel: true },
  { cle: 'client_telephone', label: 'Téléphone', question: 'Je note votre numéro ?', essentiel: true },
  { cle: 'probleme', label: 'Demande', question: 'Quels travaux souhaitez-vous ?', essentiel: true },
  { cle: 'client_ville', label: 'Ville', question: 'Dans quelle commune ?', essentiel: true },
  { cle: 'client_adresse', label: 'Adresse', question: "Quelle est l'adresse exacte ?", essentiel: true },
  { cle: 'client_code_postal', label: 'Code postal', question: 'Le code postal ?', essentiel: false },
  { cle: 'client_email', label: 'Email', question: 'Votre email pour envoyer le devis ?', essentiel: true },
  { cle: 'metiers', label: 'Métier', question: '(déduit de la demande)', essentiel: true },
  { cle: 'surface', label: 'Surface', question: 'Quelle surface, à peu près ?', essentiel: true },
  { cle: 'delai', label: 'Délai', question: 'Pour quand souhaitez-vous les travaux ?', essentiel: false },
  {
    cle: 'assurance',
    label: 'Assurance',
    question: 'Avez-vous déclaré le sinistre à votre assurance ?',
    essentiel: true,
    // Ne se pose que sur un sinistre : sinon la question n'a pas de sens et
    // pollue la liste.
    pertinent: (l) => !!l.sinistre && !['aucun', 'inconnu', ''].includes(l.sinistre),
  },
  { cle: 'disponibilite', label: 'Disponibilité', question: 'Quand seriez-vous disponible pour une visite ?', essentiel: false },
  { cle: 'budget', label: 'Budget', question: 'Avez-vous une enveloppe en tête ?', essentiel: false },
]

function texte(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  return String(v).trim()
}

export function construireChecklist(lead: LeadExtrait | null): LigneChecklist[] {
  const l = lead ?? {}
  return DEFINITIONS.filter((d) => !d.pertinent || d.pertinent(l)).map((d) => {
    const valeur = texte(l[d.cle])
    const score = l.confiance?.[d.cle] ?? (valeur ? 1 : 0)
    const etat: EtatChamp = !valeur
      ? 'manquant'
      : score >= SEUIL_CONFIANCE
        ? 'obtenu'
        : 'a_confirmer'
    return { cle: d.cle, label: d.label, question: d.question, etat, valeur, essentiel: d.essentiel }
  })
}

/** Ce qu'il reste à demander, essentiels d'abord — l'ordre d'affichage. */
export function trierPourAppel(lignes: LigneChecklist[]): LigneChecklist[] {
  const rang = (l: LigneChecklist) =>
    l.etat === 'manquant' ? (l.essentiel ? 0 : 1) : l.etat === 'a_confirmer' ? 2 : 3
  return [...lignes].sort((a, b) => rang(a) - rang(b))
}

export function nbRestant(lignes: LigneChecklist[]): number {
  return lignes.filter((l) => l.essentiel && l.etat !== 'obtenu').length
}

/**
 * Contrôles mécaniques, indépendants du modèle.
 *
 * Ces trois vérifications ont chacune attrapé une erreur réelle lors des
 * saisies manuelles : un numéro à 12 chiffres, une rue inexistante, un doublon
 * créé faute d'avoir cherché. Une IA ne les remplace pas — elle les subit.
 */
export interface Anomalie {
  champ: keyof LeadExtrait
  message: string
  gravite: 'bloquant' | 'avertissement'
}

export function verifierMecaniquement(l: LeadExtrait): Anomalie[] {
  const a: Anomalie[] = []

  const tel = (l.client_telephone ?? '').replace(/\D/g, '')
  if (tel && tel.length !== 10) {
    a.push({
      champ: 'client_telephone',
      message: `${tel.length} chiffres au lieu de 10 — à confirmer au téléphone.`,
      gravite: 'bloquant',
    })
  } else if (tel && !/^0[1-9]/.test(tel)) {
    a.push({
      champ: 'client_telephone',
      message: 'Ne commence pas par 0 suivi de 1-9 : numéro douteux.',
      gravite: 'avertissement',
    })
  }

  const cp = (l.client_code_postal ?? '').replace(/\D/g, '')
  if (cp && cp.length !== 5) {
    a.push({ champ: 'client_code_postal', message: 'Un code postal a 5 chiffres.', gravite: 'avertissement' })
  }

  const email = (l.client_email ?? '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    a.push({ champ: 'client_email', message: 'Format invalide — vérifier l\'épellation.', gravite: 'bloquant' })
  }

  return a
}
