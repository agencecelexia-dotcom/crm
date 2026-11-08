/** Garde commune aux actions photo, sans dépendance Deno ni appel fournisseur. */
export interface PhotoAvecAcces {
  cleabs: string
  source: string
  deposee_par: string | null
}

export function photoVisiblePourArtisan(photo: PhotoAvecAcces, artisan: string | null): boolean {
  // Les photos de rue restent communes. Une photo personnelle n'est pas un
  // document public, même lorsque deux chantiers visent le même bâtiment.
  return artisan == null || photo.source !== 'artisan' || photo.deposee_par === artisan
}

export function cheminDepotPhoto(cleabs: string, acteur: string, nonce: string): string {
  return `${cleabs}/artisan-${acteur}-${nonce}.jpg`
}

export function depotPhotoAutorise(chemin: unknown, cleabs: string, acteur: string): boolean {
  if (typeof chemin !== 'string') return false
  const prefixe = `${cleabs}/artisan-${acteur}-`
  return chemin.startsWith(prefixe) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(chemin.slice(prefixe.length))
}

export async function verifierAccesPhoto<T extends PhotoAvecAcces>(
  acteur: { artisan: string | null },
  action: unknown,
  entree: { cleabs?: unknown; id?: unknown },
  depot: { photo: (id: string) => Promise<T | null>; batiment: (cleabs: string) => Promise<string | null> },
): Promise<{ ok: true; photo: T | null } | { ok: false; error: string; status: number }> {
  let photo: T | null = null
  let cleabs: string
  if (action === 'lire' || action === 'ecarter') {
    if (typeof entree.id !== 'string' || !/^[0-9a-f-]{36}$/.test(entree.id)) return { ok: false, error: 'parametres_manquants', status: 400 }
    photo = await depot.photo(entree.id)
    if (!photo) return { ok: false, error: 'photo_introuvable', status: 404 }
    if (!photoVisiblePourArtisan(photo, acteur.artisan)) return { ok: false, error: 'acces_refuse', status: 403 }
    cleabs = photo.cleabs // Ne jamais faire confiance au cleabs fourni avec un id.
  } else if (['chercher', 'deposer', 'enregistrer', 'materiau_toit'].includes(String(action))) {
    if (typeof entree.cleabs !== 'string' || !/^BATIMENT\d{16}$/.test(entree.cleabs)) return { ok: false, error: 'parametres_manquants', status: 400 }
    cleabs = entree.cleabs
  } else {
    return { ok: false, error: 'action_inconnue', status: 400 }
  }
  if (acteur.artisan != null) {
    const erreur = await depot.batiment(cleabs)
    if (erreur) return { ok: false, error: erreur, status: 403 }
  }
  return { ok: true, photo }
}
