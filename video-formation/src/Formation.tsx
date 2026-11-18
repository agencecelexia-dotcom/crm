import { useEffect, useState } from 'react'
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { PARTIES, type IdPartie } from './script'
import { SCENES } from './plans'
import { bornes, CALAGE, quand } from './temps'
import { Bulle, BULLE_COIN, Entete, Fond, type Disposition } from './composants/Habillage'
import { Telephone } from './composants/Telephone'
import { Bienvenue, Lien, Pourquoi, Reflexes } from './composants/Scenes'

function usePolices() {
  const [attente] = useState(() => delayRender('Chargement des polices du CRM'))
  useEffect(() => {
    const polices = [
      new FontFace('Clash Display', `url(${staticFile('fonts/clash-display-variable.woff2')})`, { weight: '200 700' }),
      new FontFace('Plus Jakarta Sans', `url(${staticFile('fonts/plus-jakarta-sans-latin-variable.woff2')})`, { weight: '200 800' }),
    ]
    Promise.all(polices.map((p) => p.load()))
      .then((chargees) => { chargees.forEach((p) => document.fonts.add(p)); continueRender(attente) })
      .catch((e) => { console.error(e); continueRender(attente) })
  }, [attente])
}

const BULLE_ACCUEIL: Disposition = { x: 540 - 260, y: 390, d: 520 }
const BULLE_FIN: Disposition = { x: 540 - 210, y: 560, d: 420 }
const melange = (a: Disposition, b: Disposition, t: number): Disposition => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d: a.d + (b.d - a.d) * t })

/** Où se trouve la bulle d'Antoine : au centre au début et à la fin, dans le coin sinon. */
function useBulle(): Disposition {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const versCoin = bornes('pourquoi').debut
  const fin = bornes('reflexes').debut + quand('reflexes', 'Une question') - 4
  if (frame < versCoin) return BULLE_ACCUEIL
  if (frame < fin) return melange(BULLE_ACCUEIL, BULLE_COIN, spring({ frame: frame - versCoin, fps, config: { damping: 20, stiffness: 90 } }))
  return melange(BULLE_COIN, BULLE_FIN, spring({ frame: frame - fin, fps, config: { damping: 20, stiffness: 90 } }))
}

function Partie({ id }: { id: IdPartie }) {
  const frame = useCurrentFrame()
  const scene = SCENES[id]
  // L'en-tête s'efface quand la fin prend tout l'écran.
  const effacement = id === 'reflexes' ? interpolate(frame, [quand('reflexes', 'Une question') - 8, quand('reflexes', 'Une question') + 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1
  return (
    <AbsoluteFill>
      {scene.type === 'telephone' && <Telephone id={id} plans={scene.plans} />}
      {scene.type === 'bienvenue' && <Bienvenue />}
      {scene.type === 'pourquoi' && <Pourquoi />}
      {scene.type === 'lien' && <Lien />}
      {scene.type === 'reflexes' && <Reflexes />}
      {id !== 'bienvenue' && <div style={{ opacity: effacement }}><Entete id={id} /></div>}
    </AbsoluteFill>
  )
}

export function Formation() {
  usePolices()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const bulle = useBulle()
  const parle = CALAGE.parties.some((p) => frame >= p.debut * fps && frame <= p.fin * fps)
  return (
    <AbsoluteFill>
      <Fond />
      {PARTIES.map((p) => {
        const b = bornes(p.id)
        return <Sequence key={p.id} from={b.debut} durationInFrames={b.duree} name={p.titre}><Partie id={p.id} /></Sequence>
      })}
      <Bulle disposition={bulle} parle={parle} />
      {CALAGE.source === 'provisoire' && CALAGE.parties.map((p) => p.audio && (
        <Sequence key={p.id} from={Math.round(p.debut * fps)} name={`voix ${p.id}`}><Audio src={staticFile(p.audio)} /></Sequence>
      ))}
    </AbsoluteFill>
  )
}
