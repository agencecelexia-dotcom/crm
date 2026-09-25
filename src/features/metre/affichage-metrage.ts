// Comment un métré se lit à l'écran — pour l'agence comme pour l'artisan :
// la même unité, la même provenance, le même badge.

import type { Unite } from './catalogue-metrage'
import type { StatutMetrage } from './use-metrage'

export const UNITE_LISIBLE: Record<Unite, string> = { m2: 'm²', ml: 'm', m: 'm', pct: '%', u: '', oui_non: '' }

export function valeurLisible(v: number | null | undefined, unite: Unite): string {
  if (v == null) return '—'
  if (unite === 'oui_non') return v ? 'oui' : 'non'
  const n = unite === 'u' ? String(Math.round(v)) : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  return UNITE_LISIBLE[unite] ? `${n} ${UNITE_LISIBLE[unite]}` : n
}

export const SOURCE_MESURE: Record<string, string> = {
  lidar: 'LiDAR',
  google: 'Google',
  photogrammetrie: 'photogrammétrie',
  parcelle: 'cadastre',
  dessin: 'tracé',
  ia_photo: 'photo, IA',
}

/** Le statut tel que l'artisan et l'agence le lisent. */
export const BADGE_METRAGE: Record<StatutMetrage, { texte: string; classe: string }> = {
  confirme: { texte: '✓ confirmé', classe: 'bg-[#22C55E]/15 text-[#16A34A]' },
  coherent: { texte: '✓ vérifié', classe: 'bg-[#22C55E]/15 text-[#16A34A]' },
  mesure: { texte: 'mesuré', classe: 'bg-primary/10 text-primary' },
  declare: { texte: 'dit par le client', classe: 'bg-muted text-muted-foreground' },
  ecart: { texte: 'à vérifier', classe: 'bg-[#F59E0B]/15 text-[#B45309]' },
  sources_desaccord: { texte: 'à vérifier', classe: 'bg-[#F59E0B]/15 text-[#B45309]' },
}
