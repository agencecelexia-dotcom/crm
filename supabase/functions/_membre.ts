// Qui appelle ? Un membre ACTIF de l'agence, ou personne.
//
// POURQUOI CE FICHIER
//
// `transcrire-audio` (Deepgram) et `extraire-lead` (Claude) sont payantes à
// l'usage. La première était déployée sans vérification de JWT ; la seconde
// vérifiait un JWT, mais la clé publique du bundle — lisible par tous — en est
// un. L'audit l'a prouvé : sans aucun en-tête, le traitement était atteint.
// N'importe qui pouvait transcrire ou faire lire des textes aux frais de
// l'agence, sans limite.
//
// Ici, on ne croit ni le front ni la clé publique : on demande à Supabase Auth
// à qui appartient le jeton de SESSION, puis à la table `membres` si ce compte
// est actif. C'est le contrôle que fait déjà `inviter-membre`.

export interface Membre {
  user_id: string
  role: string
}

export async function membreActif(jeton: string | null | undefined): Promise<Membre | null> {
  if (!jeton) return null
  const url = Deno.env.get('SUPABASE_URL')!
  const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Le jeton est-il celui d'un utilisateur connecté ? La clé publique,
  //    elle, n'a pas d'utilisateur : Auth la refuse.
  const u = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: cle, authorization: `Bearer ${jeton}` },
  })
  if (!u.ok) return null
  const id = ((await u.json()) as { id?: string })?.id
  if (!id) return null

  // 2. Est-ce un membre actif ? La table fait foi.
  const m = await fetch(
    `${url}/rest/v1/membres?user_id=eq.${encodeURIComponent(id)}&actif=eq.true&select=role&limit=1`,
    { headers: { apikey: cle, authorization: `Bearer ${cle}` } },
  )
  if (!m.ok) return null
  const lignes = (await m.json()) as { role: string }[]
  return lignes.length ? { user_id: id, role: lignes[0].role } : null
}

/** Le jeton de session porté par l'en-tête Authorization. */
export const jetonDe = (req: Request) =>
  req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null
