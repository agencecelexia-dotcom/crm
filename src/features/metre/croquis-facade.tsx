import { useMemo } from 'react'

import { geometrieElevation } from './croquis'
import { formatM } from './geometrie'
import type { FacadeReleve } from './releve'

/** Une hauteur relevée : une décimale, comme partout ailleurs. */
const hauteur = (n: number) => `${n.toFixed(1).replace('.', ',')} m`

/**
 * La façade vue de face : chaque mur avec sa silhouette relevée au LiDAR, sa
 * longueur, ses hauteurs ; la partie mitoyenne hachurée — elle ne se peint
 * pas, et n'est pas comptée.
 */
export function CroquisFacade({ murs, orientation }: { murs: FacadeReleve[]; orientation: string }) {
  const g = useMemo(() => geometrieElevation(murs, 320), [murs])
  if (!g) return null
  const motif = `hachures-${orientation}`
  return (
    <svg
      viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
      className="h-auto max-h-56 w-full select-none"
      role="img"
      aria-label={`Élévation de la façade ${orientation}`}
    >
      <defs>
        <pattern id={motif} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} className="stroke-muted-foreground/60" strokeWidth={2} />
        </pattern>
      </defs>
      <line x1={4} y1={g.sol} x2={g.largeur - 4} y2={g.sol} className="stroke-foreground/40" strokeWidth={1} />
      {g.murs.map((m, i) => (
        <g key={i}>
          <polygon
            points={m.contour.map((p) => p.join(',')).join(' ')}
            className="fill-[#EA580C]/10 stroke-[#C2410C]"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {m.mitoyens.map((c, j) => (
            <polygon key={j} points={c.map((p) => p.join(',')).join(' ')} fill={`url(#${motif})`} className="stroke-muted-foreground/60" />
          ))}
          {m.cote && (
            <text x={m.cote.x} y={m.cote.y} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
              {formatM(m.cote.texte)}
            </text>
          )}
          {m.hauteurs.map((h, j) => (
            <text key={j} x={h.x} y={h.y} textAnchor={j === 0 ? 'start' : 'middle'} fontSize={10} className="fill-foreground">
              {hauteur(h.texte)}
            </text>
          ))}
        </g>
      ))}
    </svg>
  )
}
