import type { ProjetEspace } from '@/types/database'

/**
 * Urgence d'un chantier, pour trier et signaler visuellement.
 *
 * L'audit relevait qu'aucune dimension temporelle n'existait : 55 dossiers
 * « en attente » présentés à plat, tous identiques, et un RDV daté du 05/08
 * ne déclenchait aucune alerte le 10/08. Sans hiérarchie, l'artisan ne sait
 * pas par quoi commencer.
 */
export type NiveauUrgence = 'critique' | 'haute' | 'normale' | 'aucune'

export interface Urgence {
  niveau: NiveauUrgence
  /** Score décroissant, pour le tri à l'intérieur d'un groupe. */
  score: number
  /** Libellé court affiché sur la carte. */
  raison: string | null
  /** Famille d'action — sert à REGROUPER la liste. Un tri par score unique
   *  ne suffit pas : 20 RDV passés monopolisaient les 20 premières places et
   *  un lead reçu le jour même tombait en position 21. */
  groupe: GroupeAction
}

export type GroupeAction = 'nouveaux' | 'rdv' | 'relances' | 'devis' | 'suivi' | 'clos'

export const GROUPES: { cle: GroupeAction; label: string; aide: string }[] = [
  { cle: 'nouveaux', label: 'Nouveaux à appeler', aide: 'Reçus il y a moins de 48 h' },
  { cle: 'rdv',      label: 'Rendez-vous',        aide: 'RDV passés à mettre à jour, ou à venir' },
  { cle: 'relances', label: 'À relancer',         aide: 'Jamais contactés, ou rappel prévu' },
  { cle: 'devis',    label: 'Devis en attente',   aide: 'Envoyés, sans réponse du client' },
  { cle: 'suivi',    label: 'Autres chantiers',   aide: 'Rien d\'urgent pour l\'instant' },
  { cle: 'clos',     label: 'Terminés et perdus', aide: '' },
]

const JOUR = 86_400_000

function joursDepuis(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / JOUR)
}

/** Ancienneté lisible : « il y a 3 j », « il y a 2 mois ». */
export function ancienneteLabel(iso: string | null | undefined): string | null {
  const j = joursDepuis(iso)
  if (j == null) return null
  if (j <= 0) return "aujourd'hui"
  if (j === 1) return 'hier'
  if (j < 30) return `il y a ${j} j`
  const m = Math.floor(j / 30)
  return `il y a ${m} mois`
}

/**
 * Règles d'urgence, de la plus forte à la plus faible.
 * Un chantier gagné ou perdu n'est jamais urgent : il est sorti du flux.
 */
export function urgenceChantier(p: ProjetEspace): Urgence {
  if (p.issue === 'gagne' || p.issue === 'perdu') {
    return { niveau: 'aucune', score: 0, raison: null, groupe: 'clos' }
  }

  const rappel = p.rappel_le ? new Date(p.rappel_le).getTime() : null
  if (rappel != null && rappel <= Date.now()) {
    return { niveau: 'critique', score: 1000, raison: 'Rappel à passer', groupe: 'relances' }
  }

  // RDV daté dans le passé sans suite : c'est le cas que l'audit signalait.
  const rdv = p.date_rdv ? new Date(p.date_rdv).getTime() : null
  if (rdv != null && rdv < Date.now() && p.etape === 'rdv_pris') {
    const j = Math.floor((Date.now() - rdv) / JOUR)
    return {
      niveau: 'critique',
      score: 980 + Math.min(j, 15),
      raison: 'RDV passé, à mettre à jour',
      groupe: 'rdv',
    }
  }

  // Chantier neuf, jamais contacté : c'est une OPPORTUNITÉ, pas un retard.
  // Placé haut volontairement — avec le tri précédent, un lead reçu le jour
  // même tombait en position 25, sous des dossiers anciens dont le score
  // montait avec l'âge. Plus un lead pourrissait, plus il masquait les neufs.
  const age = joursDepuis(p.recu_le)
  if (!p.etape && age != null && age < 2) {
    return { niveau: 'haute', score: 950, raison: 'Nouveau — à appeler', groupe: 'nouveaux' }
  }

  // Jamais contacté au-delà de 48 h : là, c'est un retard. Le score est
  // PLAFONNÉ pour qu'un dossier très ancien ne passe jamais devant un
  // rappel échu ni devant un chantier fraîchement reçu.
  if (!p.etape && age != null && age >= 2) {
    return {
      niveau: 'haute',
      score: 700 + Math.min(age, 60),
      raison: `Jamais contacté (${age} j)`,
      groupe: 'relances',
    }
  }

  // Devis envoyé resté sans réponse.
  if (p.etape === 'devis_envoye') {
    const inactif = joursDepuis(p.derniere_activite)
    if (inactif != null && inactif >= 15) {
      return {
        niveau: 'haute',
        score: 600 + inactif,
        raison: `Devis sans réponse (${inactif} j)`,
        groupe: 'devis',
      }
    }
  }

  // RDV à venir : utile à voir, sans être une alerte.
  if (rdv != null && rdv >= Date.now()) {
    return { niveau: 'normale', score: 400, raison: 'RDV programmé', groupe: 'rdv' }
  }

  if (rappel != null) {
    return { niveau: 'normale', score: 300, raison: 'Rappel programmé', groupe: 'relances' }
  }

  // Dossier dormant : dernière activité ancienne.
  const inactif = joursDepuis(p.derniere_activite)
  if (inactif != null && inactif >= 21) {
    return {
      niveau: 'normale',
      score: 200 + inactif,
      raison: `Sans activité (${inactif} j)`,
      groupe: 'suivi',
    }
  }

  // Filet de sécurité : reçu il y a moins de 48 h, aucune règle ne s'est
  // déclenchée. Il n'est pas urgent, mais il ne doit pas tomber dans le
  // fourre-tout « Autres chantiers » où l'artisan ne descend jamais.
  if (age != null && age < 2) {
    return { niveau: 'normale', score: 900, raison: 'Reçu récemment', groupe: 'nouveaux' }
  }

  return { niveau: 'aucune', score: 0, raison: null, groupe: 'suivi' }
}

export const COULEUR_URGENCE: Record<NiveauUrgence, string> = {
  critique: 'border-[#DC2626]/40 bg-[#DC2626]/5 text-[#DC2626]',
  haute: 'border-[#B45309]/40 bg-[#F59E0B]/5 text-[#B45309]',
  normale: 'border-border bg-muted/40 text-muted-foreground',
  aucune: '',
}

/** Recherche plein texte simple : nom, ville, métier, description. */
export function correspond(p: ProjetEspace, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  const champs = [
    p.client_nom,
    p.client_ville,
    p.client_code_postal,
    p.client_telephone,
    p.metier,
    ...(p.metiers ?? []),
    p.description,
  ]
  return champs.some((c) => c?.toLowerCase().includes(t))
}

/**
 * Date de réception d'un chantier, en millisecondes.
 *
 * Sert de tri secondaire : à urgence égale, le plus récent passe devant.
 * Sans ce critère, un chantier reçu le jour même — qui n'a encore déclenché
 * aucune règle d'urgence — se retrouvait en bas de liste, derrière des
 * dossiers plus anciens. C'est exactement le prospect qu'il ne faut pas rater.
 */
export function dateReception(p: ProjetEspace): number {
  const iso = p.recu_le ?? p.derniere_activite
  return iso ? new Date(iso).getTime() : 0
}

/**
 * Un chantier neuf mérite d'être signalé, même sans urgence : c'est une
 * opportunité fraîche, pas un dossier en retard.
 */
export function estNouveau(p: ProjetEspace): boolean {
  if (p.etape || p.issue !== 'en_cours') return false
  const j = joursDepuis(p.recu_le)
  return j != null && j <= 2
}
