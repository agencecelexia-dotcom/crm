import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { PARTIES, type IdPartie } from '../script'
import { CALAGE, phrases } from '../temps'
import { C, POLICE, POLICE_TITRE } from '../theme'

/** Fond clair du CRM, avec deux halos violets qui dérivent lentement. */
export function Fond() {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: C.fond, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: 999, left: -300 + Math.sin(f / 140) * 60, top: -380 + Math.cos(f / 170) * 40, background: 'radial-gradient(circle, rgba(109,75,209,.16), rgba(109,75,209,0) 65%)' }} />
      <div style={{ position: 'absolute', width: 1000, height: 1000, borderRadius: 999, right: -420 + Math.cos(f / 160) * 60, bottom: -420 + Math.sin(f / 150) * 50, background: 'radial-gradient(circle, rgba(182,161,240,.22), rgba(182,161,240,0) 65%)' }} />
    </AbsoluteFill>
  )
}

/** Numéro de partie, titre, et phrase en cours (pour regarder sans le son). */
export function Entete({ id }: { id: IdPartie }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const index = PARTIES.findIndex((p) => p.id === id)
  const partie = PARTIES[index]
  const e = spring({ frame, fps, config: { damping: 20, stiffness: 120 } })
  const phrase = phrases(id).filter((p) => frame >= p.debut - 3).at(-1)
  const age = phrase ? frame - phrase.debut : 0
  return (
    <div style={{ position: 'absolute', left: 64, top: 70, width: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: e }}>
        <span style={{ fontFamily: POLICE, fontWeight: 700, fontSize: 24, color: C.violet, background: C.violetPale, borderRadius: 999, padding: '7px 16px' }}>{index} / {PARTIES.length - 1}</span>
      </div>
      <h1 style={{ margin: '18px 0 0', fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 64, lineHeight: 1.04, letterSpacing: -1, color: C.texte, transform: `translateY(${(1 - e) * 30}px)`, opacity: e }}>{partie.titre}</h1>
      {phrase && (
        <p style={{ margin: '20px 0 0', fontFamily: POLICE, fontWeight: 500, fontSize: 29, lineHeight: 1.35, color: C.doux, opacity: interpolate(age, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), height: 118, overflow: 'hidden' }}>{phrase.texte}</p>
      )}
    </div>
  )
}

export type Disposition = { x: number; y: number; d: number }
export const BULLE_COIN: Disposition = { x: 1080 - 64 - 290, y: 64, d: 290 }

/**
 * Antoine, en rond. Tant que sa vidéo n'est pas tournée : un cercle de
 * remplacement qui « parle » au rythme de la voix provisoire.
 */
export function Bulle({ disposition, parle }: { disposition: Disposition; parle: boolean }) {
  const frame = useCurrentFrame()
  const { x, y, d } = disposition
  const anneau = parle ? 6 + Math.abs(Math.sin(frame / 3.1)) * 7 + Math.abs(Math.sin(frame / 7.3)) * 5 : 5
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: d, height: d }}>
      <div style={{ position: 'absolute', inset: -anneau, borderRadius: 999, background: `conic-gradient(from ${frame * 2}deg, ${C.violet}, ${C.violetClair}, ${C.violet})`, opacity: 0.9 }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: 999, overflow: 'hidden', background: '#1d1b26', boxShadow: '0 20px 50px rgba(32,35,43,.3)' }}>
        {CALAGE.source === 'antoine' && CALAGE.video ? (
          <OffthreadVideo src={staticFile(CALAGE.video)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: CALAGE.cadrage ?? '50% 35%' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: `radial-gradient(circle at 35% 30%, #8e6ff0, ${C.violet} 55%, #3d2a86)` }}>
            <div style={{ textAlign: 'center', color: 'white', fontFamily: POLICE }}>
              <div style={{ fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: d * 0.36, lineHeight: 1 }}>A</div>
              <div style={{ fontSize: Math.max(14, d * 0.07), fontWeight: 600, opacity: 0.85, marginTop: d * 0.03 }}>Antoine</div>
              <div style={{ fontSize: Math.max(11, d * 0.048), opacity: 0.7, marginTop: 4 }}>vidéo à venir</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Logo({ largeur, style }: { largeur: number; style?: React.CSSProperties }) {
  return <Img src={staticFile('logo.png')} style={{ width: largeur, height: (largeur * 98) / 605, mixBlendMode: 'multiply', ...style }} />
}
