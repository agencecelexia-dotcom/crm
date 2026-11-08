import type { Point } from './geometrie'
import type { Metre } from './use-metres'

export function traceManuelAffichable(m: Metre): boolean {
  return m.source === 'dessin' && (m.type === 'surface' || m.type === 'longueur') &&
    m.pente_pct == null && m.hauteur_m == null && !m.releve_id &&
    (m.surface_reelle_m2 == null || Number(m.surface_reelle_m2) === Number(m.surface_m2))
}

export function traceManuelModifiable(m: Metre): boolean {
  return traceManuelAffichable(m) && m.modifiable_trace === true
}

export function traceModifie(m: Metre | null, nom: string, trace: Point[]): boolean {
  return !!m && (nom.trim() !== m.nom || JSON.stringify(trace) !== JSON.stringify(m.geometrie))
}

