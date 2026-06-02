// ------------------------------------------------------------
//  Autocomplétion code postal ↔ ville via geo.api.gouv.fr (gratuit, sans clé).
// ------------------------------------------------------------

export interface Commune {
  nom: string
  codesPostaux: string[]
}

/** Communes correspondant à un code postal (un CP peut couvrir plusieurs communes). */
export async function communesParCodePostal(cp: string): Promise<Commune[]> {
  if (!/^\d{5}$/.test(cp)) return []
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom,codesPostaux&format=json`,
    )
    if (!r.ok) return []
    return (await r.json()) as Commune[]
  } catch {
    return []
  }
}

/** Communes correspondant à un début de nom (triées par population). */
export async function communesParNom(nom: string): Promise<Commune[]> {
  const q = nom.trim()
  if (q.length < 2) return []
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,codesPostaux&boost=population&limit=8`,
    )
    if (!r.ok) return []
    return (await r.json()) as Commune[]
  } catch {
    return []
  }
}
