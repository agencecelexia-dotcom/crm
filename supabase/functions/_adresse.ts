// Les règles d'adresse de `batiment-chantier`, sans réseau ni Deno : la
// fonction et les tests unitaires lisent le même code.
//
// Elles répondent à une question simple — l'adresse que la BAN a retrouvée
// est-elle bien celle qu'on a saisie ? — que le score seul tranche mal : il
// s'effondre sur un code postal répété, et reste honorable pour le même numéro
// dans une autre rue.

/** « Sathonay-Village » et « sathonay village » sont la même commune ; « Saint » et « St » aussi. */
export const normaliser = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Même commune, à l'écriture près : « abbansdessus » tel que saisi est bien Abbans-Dessus. */
export const memeCommune = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && normaliser(a).replace(/ /g, '') === normaliser(b).replace(/ /g, '')

/** La voie telle que saisie, sans le code postal ni la commune : « 1 allée des Sapins ». */
export function voieSaisie(adresse: string): string {
  const morceaux = adresse.split(',').map((m) => m.trim()).filter(Boolean)
  const voie = morceaux.find((m) => /^\d+\s*[a-z]?\b/i.test(m)) ?? morceaux[0] ?? ''
  return voie.replace(/\b\d{5}\b.*$/, '').trim()
}

/** Code postal et commune, quand ils n'ont été tapés que dans l'adresse. */
export function lieuSaisi(adresse: string): { codePostal: string | null; commune: string | null } {
  const codePostal = adresse.match(/\b(\d{5})\b/)?.[1] ?? null
  const commune =
    adresse.match(/\b\d{5}\s+([^,\d][^,]*)/)?.[1]?.trim() ?? // « …, 69580 Sathonay-Village »
    adresse.match(/,\s*([^,\d][^,]*?)\s+\d{5}\s*$/)?.[1]?.trim() ?? // « …, Canet-en-Roussillon 66140 »
    null
  return { codePostal, commune }
}

/**
 * La requête d'adresse, SANS DOUBLON.
 *
 * L'adresse saisie contient souvent déjà le code postal et la ville ; les
 * rajouter faisait tomber le score de la BAN — 0,635 au lieu de 0,979 pour
 * « 22 rue de la Griesmatt, 67100 Strasbourg » — et l'écran aurait demandé
 * confirmation pour une adresse parfaitement reconnue.
 */
export function requeteAdresse(adresse: string, codePostal: string | null, ville: string | null): string {
  const dejaLa = normaliser(adresse).replace(/ /g, '')
  const morceaux = [adresse.trim()]
  if (codePostal && !adresse.includes(codePostal)) morceaux.push(codePostal)
  if (ville && !dejaLa.includes(normaliser(ville).replace(/ /g, ''))) morceaux.push(ville)
  return morceaux.join(' ')
}

/** Les mots qui ne nomment pas une rue : son type, les articles. */
const MOTS_VIDES = new Set(
  ('rue r avenue av ave boulevard bd bld allee all chemin ch che place pl impasse imp route rte quai cours ' +
    'square sq passage sentier lotissement lot residence res hameau lieu dit lieudit voie cite clos parc ' +
    'de du des la le les l d et a au aux en sur sous saint sainte bis ter quater').split(' '),
)
export const motsRue = (s: string) =>
  normaliser(s).split(' ').filter((m) => m.length >= 2 && !/^\d/.test(m) && !MOTS_VIDES.has(m))

/** Deux mots égaux à une faute de frappe près (« fleurie » pour « fleuri »). */
export function presque(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false
  let i = 0, j = 0, fautes = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++fautes > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return fautes + (a.length - i) + (b.length - j) <= 1
}

/**
 * La rue retrouvée est-elle celle qu'on a saisie ? Faute de mieux, la BAN
 * renvoie volontiers le même numéro dans une AUTRE rue de la commune
 * (« 25 rue du Chatelot » pour « 25 rue du fraine ») : le score ne suffit pas
 * à le voir, les mots de la rue, si.
 */
export function memeRue(saisie: string, retrouvee: string): boolean {
  const cibles = motsRue(retrouvee)
  if (!cibles.length) return true
  const mots = motsRue(saisie)
  return cibles.filter((c) => mots.some((m) => presque(m, c))).length * 2 >= cibles.length
}

/** « 1B », « 1 bis » et « 1bis » sont le même numéro ; « 1 » et « 1B » non. */
export const numeroNormalise = (n: string | null | undefined) =>
  (n ?? '').toLowerCase().replace(/\s+/g, '').replace(/bis$/, 'b').replace(/ter$/, 't').replace(/quater$/, 'q')
export const numeroSaisi = (voie: string) => voie.match(/^(\d+(?:\s*(?:bis|ter|quater)\b|[a-z]\b)?)/i)?.[1] ?? null
