/**
 * Adresse de site web saisie par un artisan → lien sûr à afficher.
 *
 * « www.atelier.fr » devient « https://www.atelier.fr ». Tout ce qui n'est
 * pas une adresse http(s) avec un vrai nom de domaine (javascript:, texte
 * libre, « non »…) renvoie null : la base applique la même règle (0201).
 */
export function normaliserSiteWeb(saisie: string | null | undefined): string | null {
  const brut = saisie?.trim() ?? ''
  if (!brut || /\s/.test(brut)) return null
  const avecSchema = /^[a-z][a-z\d+.-]*:/i.test(brut) ? brut : `https://${brut.replace(/^\/+/, '')}`
  try {
    const url = new URL(avecSchema)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!/^[^.]+(\.[^.]+)+$/.test(url.hostname) || url.username || url.password) return null
    return avecSchema
  } catch {
    return null
  }
}

/** « https://www.atelier.fr/accueil » → « atelier.fr/accueil » (affichage court). */
export function libelleSiteWeb(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}
