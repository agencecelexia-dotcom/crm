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
  /** Qui est au bout du fil : tous les appels ne viennent pas de clients. */
  nature_appel?: 'client' | 'artisan_cherche_travail' | 'demarchage' | 'indetermine'
  /** Métier et zone de l'artisan, quand il en est un — utile au recrutement. */
  artisan_metier?: string
  confiance?: Record<string, number>
}

export type EtatChamp = 'obtenu' | 'a_confirmer' | 'manquant' | 'saisi'

/** Champs saisis à la main par le commercial pendant l'appel.
 *
 *  Ils PRIMENT sur l'extraction et ne sont jamais écrasés : sans cette règle,
 *  le commercial corrigerait un champ et le verrait revenir à la version
 *  automatique quelques secondes plus tard — il se battrait contre l'outil au
 *  lieu de parler à son client. */
export type Saisies = Partial<Record<keyof LeadExtrait, string>>

export interface LigneChecklist {
  cle: keyof LeadExtrait
  /** Vrai si la valeur vient du clavier, pas de l'extraction. */
  manuel: boolean
  /** Ce que l'écoute a capté, TOUJOURS renseigné même quand le commercial a
   *  saisi le champ lui-même. Les deux sources restent visibles côte à côte :
   *  c'est le principe du recoupement — on ne croise pas deux informations si
   *  l'une disparaît dès que l'autre existe. */
  valeurIa: string
  /** Confiance de l'écoute sur ce champ, pour nuancer l'affichage. */
  confianceIa: number
  /** Renseigné seulement quand les deux sources DIVERGENT : c'est le signal
   *  qui mérite un coup d'œil pendant que le client est en ligne. */
  suggestionIa: string | null
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

export function construireChecklist(
  lead: LeadExtrait | null,
  saisies: Saisies = {},
): LigneChecklist[] {
  const l = lead ?? {}
  return DEFINITIONS.filter((d) => !d.pertinent || d.pertinent(l)).map((d) => {
    const auto = texte(l[d.cle])
    const manuelle = (saisies[d.cle] ?? '').trim()
    const manuel = manuelle.length > 0
    const valeur = manuel ? manuelle : auto
    const score = l.confiance?.[d.cle] ?? (auto ? 1 : 0)

    const etat: EtatChamp = manuel
      ? 'saisi'
      : !valeur
        ? 'manquant'
        : score >= SEUIL_CONFIANCE
          ? 'obtenu'
          : 'a_confirmer'

    return {
      cle: d.cle,
      label: d.label,
      question: d.question,
      etat,
      valeur,
      essentiel: d.essentiel,
      manuel,
      valeurIa: auto,
      confianceIa: score,
      // Divergence entre les deux sources : on ne la masque pas.
      suggestionIa: manuel && auto && !equivalent(auto, manuelle) ? auto : null,
    }
  })
}

/** Comparaison indulgente : ni la casse, ni les accents, ni les espaces ne
 *  constituent une divergence digne d'être signalée. Un téléphone saisi
 *  « 06 12 34 56 78 » et extrait « 0612345678 » est la même valeur. */
function equivalent(a: string, b: string): boolean {
  const n = (x: string) =>
    x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s.\-_]/g, '')
  return n(a) === n(b)
}

/** Valeurs finales : la saisie manuelle prime, l'extraction complète. */
export function fusionner(lead: LeadExtrait | null, saisies: Saisies): LeadExtrait {
  const f: LeadExtrait = { ...(lead ?? {}) }
  for (const [cle, v] of Object.entries(saisies)) {
    const val = (v ?? '').trim()
    if (!val) continue
    if (cle === 'metiers') f.metiers = val.split(',').map((m) => m.trim()).filter(Boolean)
    else (f as Record<string, unknown>)[cle] = val
  }
  return f
}

/** Ce qu'il reste à demander, essentiels d'abord — l'ordre d'affichage. */
export function trierPourAppel(lignes: LigneChecklist[]): LigneChecklist[] {
  // Un champ saisi à la main est réglé : il descend avec les champs obtenus.
  const rang = (l: LigneChecklist) =>
    l.etat === 'manquant' ? (l.essentiel ? 0 : 1) : l.etat === 'a_confirmer' ? 2 : 3
  return [...lignes].sort((a, b) => rang(a) - rang(b))
}

export function nbRestant(lignes: LigneChecklist[]): number {
  return lignes.filter((l) => l.essentiel && l.etat !== 'obtenu' && l.etat !== 'saisi').length
}

/** Champs où saisie manuelle et extraction divergent : à vérifier avant
 *  d'enregistrer. C'est le bénéfice direct de la double saisie. */
export function divergences(lignes: LigneChecklist[]): LigneChecklist[] {
  return lignes.filter((l) => l.suggestionIa != null)
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
