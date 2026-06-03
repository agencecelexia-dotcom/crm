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

/** Formate un numéro de téléphone FR par paires : "0612345678" → "06 12 34 56 78". */
export function formatTel(tel: string | null | undefined): string {
  if (!tel) return ''
  const d = tel.replace(/\D/g, '')
  if (d.startsWith('33') && d.length === 11) {
    return '+33 ' + d.slice(2).replace(/(\d{2})(?=\d)/g, '$1 ').trim()
  }
  const groupe = d.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
  return groupe || tel
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
