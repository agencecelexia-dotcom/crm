import type { Unite } from './catalogue-metrage'
import type { LigneMetrage, StatutMetrage } from './use-metrage'

/** Une absence n'est jamais convertie en zéro ; les unités discrètes restent discrètes. */
export function quantiteValide(v: unknown, unite: Unite): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 &&
    (unite !== 'u' || Number.isInteger(v)) && (unite !== 'oui_non' || v === 0 || v === 1)
}

/** Nombre français complet : « 1 200,5 » est accepté, « 12abc » jamais tronqué à 12. */
export function lireValeurMetrage(saisie: string, unite: Unite): number | null {
  const texte = saisie.trim()
  if (!/^(?:(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[,.]\d+)?|[,.]\d+)$/.test(texte)) return null
  const valeur = Number(texte.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'))
  return quantiteValide(valeur, unite) && valeur <= 100000 ? valeur : null
}

export interface EstimationMetrage {
  unite: Unite
  valeur: number | null
  /** Une sélection de pans/versant ou un autre bâtiment n'est pas la quantité globale du chantier. */
  portee?: 'chantier' | 'selection'
  enCours?: boolean
}

export function resoudreValeurMetrage(carte: EstimationMetrage, dossier: LigneMetrage | null) {
  const uniteIncompatible = carte.portee !== 'selection' && !!dossier && dossier.unite !== carte.unite
  const ligne = carte.portee === 'selection' || uniteIncompatible ? null : dossier
  const lire = (v: unknown) => quantiteValide(v, carte.unite) ? v : null
  const calculee = lire(carte.valeur)
  const humaine = ligne?.statut === 'confirme' && (ligne.retenue_par === 'artisan' || ligne.retenue_par === 'agence') ? lire(ligne.valeur_retenue) : null
  const mesuree = lire(ligne?.valeur_mesuree)
  const declaree = lire(ligne?.valeur_declaree)
  const retenue = ligne && ['mesure', 'coherent', 'declare'].includes(ligne.statut) ? lire(ligne.valeur_retenue) : null
  const valeur = humaine ?? calculee ?? retenue ?? mesuree ?? declaree
  const origine = humaine != null ? 'humaine' : calculee != null ? 'calcul' : retenue != null && ligne?.statut === 'declare' ? 'declaree' : (retenue ?? mesuree) != null ? 'dossier' : declaree != null ? 'declaree' : 'absente'
  const aVerifier = ligne?.statut === 'ecart' || ligne?.statut === 'sources_desaccord'
  const statut: StatutMetrage | null = humaine != null ? 'confirme' : valeur == null ? null : aVerifier ? ligne!.statut : origine === 'declaree' ? 'declare' : ligne?.statut === 'coherent' && valeur === mesuree ? 'coherent' : 'mesure'
  return { valeur, origine, statut, humaine, calculee, declaree, ligne, uniteIncompatible, enAttente: !!carte.enCours && valeur == null }
}
