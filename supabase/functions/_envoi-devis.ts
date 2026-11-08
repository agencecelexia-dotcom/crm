/** Un simple HTTP 200 ne prouve pas la prise en charge d'un email. */
export function priseEnChargeConfirmee(reponse: unknown, cle: string): boolean {
  if (!reponse || typeof reponse !== 'object') return false
  const r = reponse as Record<string, unknown>
  return r.ok === true && r.accepted === true && r.idempotency_key === cle
}

/** Interdit d'utiliser le proxy d'envoi comme relais de téléchargement externe. */
export function pdfDevisAutorise(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url)
    const origine = new URL(supabaseUrl)
    return u.protocol === 'https:' && u.origin === origine.origin && !u.username && !u.password
      && /^\/storage\/v1\/object\/public\/devis\/genere\/[a-f0-9]{64}\/[^/]+\.pdf$/.test(u.pathname)
  } catch { return false }
}
