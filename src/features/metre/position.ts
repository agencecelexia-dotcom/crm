import { chercherAdresse } from './use-metres'
import { distance, type Point } from './geometrie'

/**
 * Savoir si l'on est sur la bonne maison — et le dire quand on l'ignore.
 *
 * C'EST LE DÉFAUT QUI A FAILLI TOUT DISCRÉDITER
 *
 * Un audit l'a montré : sur trente-quatre chantiers d'un artisan, DEUX sont
 * géolocalisés à moins de quatre-vingts mètres de leur adresse. Un chantier
 * annoncé à Lautenbach-Zell était enregistré à Nogent-sur-Marne, trois cent
 * cinquante-neuf kilomètres plus loin — et l'outil y a présélectionné un
 * pavillon, affiché son emprise et sa pente, sans le moindre doute.
 *
 * La cause n'est pas dans la carte : cent cinquante projets sur trois cent
 * dix-huit n'ont AUCUNE ADRESSE, seulement une ville. Le géocodage tombe alors
 * sur le centre du bourg, à des centaines de mètres de la maison.
 *
 * Des chiffres justes sur la mauvaise maison sont pires que pas de chiffres.
 * On établit donc, avant toute mesure, ce qu'on sait vraiment de la position,
 * et l'écran le dit.
 */

export type Fiabilite = 'exacte' | 'rue' | 'commune' | 'discordante' | 'inconnue'

export interface PositionChantier {
  point: Point | null
  fiabilite: Fiabilite
  /** L'adresse telle que la Base Adresse Nationale la reconnaît. */
  libelle: string | null
  /** Écart entre la position enregistrée et l'adresse retrouvée, en mètres. */
  ecart: number | null
  /** Ce qu'on dit à l'artisan. Null quand il n'y a rien à signaler. */
  message: string | null
  /** La présélection d'un bâtiment n'est permise qu'à cette condition. */
  fiable: boolean
}

/** Au-delà, la position enregistrée et l'adresse ne désignent pas la même maison. */
const ECART_MAX_M = 120

const distanceLisible = (m: number) =>
  m >= 1000 ? `${Math.round(m / 1000)} km` : `${Math.round(m)} m`

/**
 * Situe un chantier à partir de ce qu'on a : son adresse et sa position.
 *
 * L'ADRESSE L'EMPORTE SUR LA POSITION. Cette dernière vient d'un géocodage
 * fait à la création du projet, en cascade, qui retombe sur la ville faute de
 * mieux. Quand l'adresse existe et se résout à un numéro, elle est plus sûre.
 */
export async function situerChantier(
  p: {
    adresse?: string | null
    codePostal?: string | null
    ville?: string | null
    latitude?: number | null
    longitude?: number | null
  },
  signal?: AbortSignal,
): Promise<PositionChantier> {
  const stockee: Point | null =
    p.latitude != null && p.longitude != null ? [p.longitude, p.latitude] : null

  const requete = [p.adresse, p.codePostal, p.ville].filter(Boolean).join(' ').trim()
  if (!requete) {
    return {
      point: stockee,
      fiabilite: stockee ? 'commune' : 'inconnue',
      libelle: null,
      ecart: null,
      fiable: false,
      message: stockee
        ? 'Aucune adresse au dossier : la carte s’ouvre sur la commune. Cherchez l’adresse pour mesurer la bonne maison.'
        : 'Ce chantier n’a ni adresse ni position. Cherchez l’adresse.',
    }
  }

  const resultats = await chercherAdresse(requete, signal).catch(() => [])
  const trouve = resultats[0]

  if (!trouve) {
    return {
      point: stockee,
      fiabilite: stockee ? 'commune' : 'inconnue',
      libelle: null,
      ecart: null,
      fiable: false,
      message: `L’adresse « ${requete} » n’est pas reconnue. Vérifiez-la, ou cherchez-la à la main.`,
    }
  }

  const trouvePoint: Point = [trouve.lon, trouve.lat]
  const ecart = stockee ? distance(stockee, trouvePoint) : null

  // L'adresse se résout à un numéro : c'est la meilleure position possible.
  if (trouve.precise) {
    // Mais si la position enregistrée en est très loin, il faut le dire : l'une
    // des deux est fausse, et l'artisan doit trancher avant de mesurer.
    if (ecart != null && ecart > ECART_MAX_M) {
      return {
        point: trouvePoint,
        fiabilite: 'discordante',
        libelle: trouve.label,
        ecart,
        fiable: false,
        message:
          `La position enregistrée est à ${distanceLisible(ecart)} de l’adresse du dossier. ` +
          `La carte s’ouvre sur l’adresse — vérifiez que c’est bien la maison, puis corrigez ` +
          `la position avec « Le chantier est ici ».`,
      }
    }
    return {
      point: trouvePoint,
      fiabilite: 'exacte',
      libelle: trouve.label,
      ecart,
      fiable: true,
      message: null,
    }
  }

  // La rue ou la commune seulement : on ne peut désigner aucune maison.
  const rue = /\d/.test(requete)
  return {
    point: trouvePoint,
    fiabilite: rue ? 'rue' : 'commune',
    libelle: trouve.label,
    ecart,
    fiable: false,
    message: rue
      ? `Seule la rue est reconnue, pas le numéro. Repérez la maison sur la photo avant de mesurer.`
      : `Seule la commune est connue (${trouve.label}). Cherchez l’adresse exacte, sans quoi vous mesureriez la maison d’un autre.`,
  }
}
