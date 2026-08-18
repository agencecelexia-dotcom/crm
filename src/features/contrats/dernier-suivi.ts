import type { ProjetEspace, Suivi } from '@/types/database'

/**
 * Dernier suivi PORTEUR DE SENS.
 *
 * Un changement d'étape sans message n'apprend rien qui ne soit déjà affiché
 * par le badge de statut. On remonte donc au dernier élément qui porte un
 * texte — c'est lui qui dit ce qui s'est réellement passé : « sms laissé ce
 * jour », « pas de réponse », une consigne de l'agence.
 */
export function dernierSuiviParlant(p: ProjetEspace): Suivi | null {
  const avecTexte = (p.suivis ?? []).filter((s) => (s.message ?? '').trim().length > 0)
  if (avecTexte.length === 0) return null
  return avecTexte.reduce((a, b) => (a.created_at >= b.created_at ? a : b))
}

/** Date relative lisible : « aujourd'hui à 12:50 », « 10 août à 12:50 ». */
export function dateLisible(iso: string): string {
  const d = new Date(iso)
  const jours = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (jours === 0) return `aujourd'hui à ${heure}`
  if (jours === 1) return `hier à ${heure}`
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${heure}`
}
