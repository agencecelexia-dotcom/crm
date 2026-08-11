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
  /** Score décroissant, pour le tri. */
  score: number
  /** Libellé court affiché sur la carte. */
  raison: string | null
}

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
    return { niveau: 'aucune', score: 0, raison: null }
  }

  const rappel = p.rappel_le ? new Date(p.rappel_le).getTime() : null
  if (rappel != null && rappel <= Date.now()) {
    return { niveau: 'critique', score: 1000, raison: 'Rappel à passer' }
  }

  // RDV daté dans le passé sans suite : c'est le cas que l'audit signalait.
  const rdv = p.date_rdv ? new Date(p.date_rdv).getTime() : null
  if (rdv != null && rdv < Date.now() && p.etape === 'rdv_pris') {
    const j = Math.floor((Date.now() - rdv) / JOUR)
    return { niveau: 'critique', score: 900 + j, raison: 'RDV passé, à mettre à jour' }
  }

  // Jamais contacté depuis plus de 48 h.
  const age = joursDepuis(p.recu_le)
  if (!p.etape && age != null && age >= 2) {
    return { niveau: 'haute', score: 700 + age, raison: `Jamais contacté (${age} j)` }
  }

  // Devis envoyé resté sans réponse.
  if (p.etape === 'devis_envoye') {
    const inactif = joursDepuis(p.derniere_activite)
    if (inactif != null && inactif >= 15) {
      return { niveau: 'haute', score: 600 + inactif, raison: `Devis sans réponse (${inactif} j)` }
    }
  }

  // RDV à venir : utile à voir, sans être une alerte.
  if (rdv != null && rdv >= Date.now()) {
    return { niveau: 'normale', score: 400, raison: 'RDV programmé' }
  }

  if (rappel != null) {
    return { niveau: 'normale', score: 300, raison: 'Rappel programmé' }
  }

  // Dossier dormant : dernière activité ancienne.
  const inactif = joursDepuis(p.derniere_activite)
  if (inactif != null && inactif >= 21) {
    return { niveau: 'normale', score: 200 + inactif, raison: `Sans activité (${inactif} j)` }
  }

  return { niveau: 'aucune', score: 0, raison: null }
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
