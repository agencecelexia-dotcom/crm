/**
 * Le métier du chantier choisit ce que l'écran montre d'abord.
 *
 * Un couvreur ouvre la fiche pour son toit, un façadier pour ses murs, un
 * poseur de clôture pour son terrain. Le métier était connu — et utilisé nulle
 * part : chacun tombait sur l'onglet « Toiture » et devait chercher le sien.
 */
export type VueMetier = 'toit' | 'facades' | 'terrain' | 'tout'

const VUES: Record<string, VueMetier> = {
  Couverture: 'toit',
  Toiture: 'toit',
  'Solaire / Photovoltaïque': 'toit',
  'Façade / Ravalement': 'facades',
  Isolation: 'facades',
  Peinture: 'facades',
  Maçonnerie: 'facades',
  Clôture: 'terrain',
  Portail: 'terrain',
  Paysagisme: 'terrain',
  Terrasse: 'terrain',
  Piscine: 'terrain',
}

/**
 * La vue d'un chantier. Plusieurs métiers qui ne s'accordent pas — toiture et
 * façade sur le même chantier — donnent la vue complète : on ne cache rien.
 */
export function vueDuChantier(metiers: (string | null | undefined)[]): VueMetier {
  const vues = new Set(metiers.map((m) => VUES[m ?? '']).filter((v): v is VueMetier => !!v))
  return vues.size === 1 ? [...vues][0] : 'tout'
}
