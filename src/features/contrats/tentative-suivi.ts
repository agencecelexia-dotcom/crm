/** Une tentative garde sa clé jusqu'à confirmation, y compris après réouverture.
 * Le stockage ne contient ni jeton, ni note, ni coordonnées : seulement une
 * empreinte SHA-256 de l'affectation/action/contenu et un UUID aléatoire.
 */
export interface TentativeSuivi {
  cle: string
  emplacement: string
}

const enMemoire = new Map<string, string>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function obtenirTentativeSuivi(token: string, action: 'suivi' | 'appel', contenu: unknown): Promise<TentativeSuivi> {
  const octets = new TextEncoder().encode(JSON.stringify([token, action, contenu]))
  const hash = await crypto.subtle.digest('SHA-256', octets)
  const empreinte = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  const emplacement = `crm:suivi:v1:${empreinte}`
  let cle = enMemoire.get(emplacement)
  try {
    const stockee = sessionStorage.getItem(emplacement)
    if (stockee && UUID.test(stockee)) cle = stockee
  } catch { /* Stockage interdit : conserve au moins la tentative dans cet onglet. */ }
  cle ??= crypto.randomUUID()
  enMemoire.set(emplacement, cle)
  try { sessionStorage.setItem(emplacement, cle) } catch { /* Même protection en mémoire. */ }
  return { cle, emplacement }
}

export function confirmerTentativeSuivi(tentative: TentativeSuivi) {
  if (enMemoire.get(tentative.emplacement) === tentative.cle) enMemoire.delete(tentative.emplacement)
  try {
    if (sessionStorage.getItem(tentative.emplacement) === tentative.cle) sessionStorage.removeItem(tentative.emplacement)
  } catch { /* Aucun texte privé n'est conservé. */ }
}
