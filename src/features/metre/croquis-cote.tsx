import { useMemo } from 'react'

import { geometrieCroquis } from './croquis'
import { formatM, type Point } from './geometrie'

/**
 * Le croquis coté de la maison : son contour, nord en haut, la longueur de
 * chaque mur écrite à l'extérieur. Toucher un mur choisit sa façade.
 */
export function CroquisCote({
  contour,
  surligne,
  onChoisir,
}: {
  contour: Point[]
  /** L'orientation de la façade en cours : ses murs s'allument. */
  surligne?: string | null
  onChoisir?: (orientation: string) => void
}) {
  const g = useMemo(() => geometrieCroquis(contour, 320), [contour])
  if (!g) return null
  return (
    <svg
      viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
      className="h-auto max-h-56 w-full select-none"
      role="img"
      aria-label="Croquis coté de la maison"
    >
      <polygon
        points={g.contour.map((p) => p.join(',')).join(' ')}
        className="fill-primary/5 stroke-foreground/50"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {g.cotes.map((c, i) => {
        const allume = surligne === c.orientation
        return (
          <g
            key={i}
            onClick={onChoisir ? () => onChoisir(c.orientation) : undefined}
            className={onChoisir ? 'cursor-pointer' : undefined}
          >
            {/* Une bande large et invisible : un mur de 2 mm se touche mal au doigt. */}
            <line x1={c.a[0]} y1={c.a[1]} x2={c.b[0]} y2={c.b[1]} stroke="transparent" strokeWidth={18} />
            {allume && (
              <line x1={c.a[0]} y1={c.a[1]} x2={c.b[0]} y2={c.b[1]} stroke="#EA580C" strokeWidth={5} strokeLinecap="round" />
            )}
            {c.longueur >= 1.5 && (
              <text
                x={c.etiquette[0]}
                y={c.etiquette[1]}
                textAnchor="middle"
                dominantBaseline="middle"
                className={allume ? 'fill-[#C2410C] font-semibold' : 'fill-muted-foreground'}
                fontSize={10}
              >
                {formatM(c.longueur)}
              </text>
            )}
          </g>
        )
      })}
      {/* Le nord, pour lire les orientations. */}
      <g transform={`translate(${g.largeur - 14}, 16)`} className="fill-foreground/70">
        <path d="M0,-10 L5,6 L0,3 L-5,6 Z" />
        <text y={17} textAnchor="middle" fontSize={9} className="fill-muted-foreground">
          N
        </text>
      </g>
    </svg>
  )
}
