import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

// Helpers de formatage (montants € et dates) — centralisés pour cohérence.

/** Formate un montant en euros (ex : 12 500 €). null/undefined → "—". */
export function formatEuros(montant: number | null | undefined): string {
  if (montant == null) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(montant)
}

/** Formate une date ISO en JJ/MM/AAAA. null/undefined → "—". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'dd/MM/yyyy', { locale: fr })
  } catch {
    return '—'
  }
}

/** Formate une date+heure ISO (ex : 2 juin 2026 à 14:30). */
export function formatDateHeure(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), "d MMM yyyy 'à' HH:mm", { locale: fr })
  } catch {
    return '—'
  }
}
