import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import boitesBrutes from '../../public/captures/boites.json'
import type { IdPartie } from '../script'
import type { Marque, Plan } from '../plans'
import { quand } from '../temps'
import { C, ECRAN, POLICE } from '../theme'

type Boite = { x: number; y: number; w: number; h: number }
const BOITES = boitesBrutes as Record<string, Record<string, Boite>>
const boiteDe = (capture: string, cle: string) => {
  const b = BOITES[capture]?.[cle]
  if (!b) throw new Error(`Boîte ${capture}.${cle} absente : relancer la capture`)
  return b
}

// Téléphone à l'écran : barre d'état (fixe) puis la capture, sous l'en-tête.
export const TEL = { x: 540, haut: 455, echelle: 1.58, bord: 16, barre: 47 }
const LE = ECRAN.l * TEL.echelle
const HE = ECRAN.h * TEL.echelle
const HB = TEL.barre * TEL.echelle

type Camera = { z: number; cx: number; cy: number }
function camera(plan: Plan): Camera {
  if (!plan.zoom) return { z: 1, cx: ECRAN.l / 2, cy: ECRAN.h / 2 }
  const b = boiteDe(plan.capture, plan.zoom)
  const z = Math.max(1, Math.min(2.1, (ECRAN.l * 0.92) / b.w, (ECRAN.h * 0.62) / b.h))
  // Centre visé, sans faire sortir l'écran du cadre.
  const demi = { l: ECRAN.l / 2 / z, h: ECRAN.h / 2 / z }
  const cx = Math.min(ECRAN.l - demi.l, Math.max(demi.l, b.x + b.w / 2))
  const cy = Math.min(ECRAN.h - demi.h, Math.max(demi.h, b.y + b.h / 2))
  return { z, cx, cy }
}

export function debutsPlans(id: IdPartie, plans: Plan[]) {
  return plans.map((p, i) => (i === 0 ? 0 : Math.max(0, quand(id, p.mot) - 6)))
}

/** Écran capturé, caméra, mises en valeur et toucher. */
function Ecran({ id, plan, debut, cam }: { id: IdPartie; plan: Plan; debut: number; cam: Camera }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const marques = (plan.marques ?? []).map((m) => ({ ...m, t: Math.max(debut, quand(id, m.mot)) }))
  const active = marques.filter((m) => frame >= m.t).at(-1)
  return (
    <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `scale(${TEL.echelle * cam.z}) translate(${ECRAN.l / 2 / cam.z - cam.cx}px, ${ECRAN.h / 2 / cam.z - cam.cy}px)` }}>
      <Img src={staticFile(`captures/${plan.capture}.png`)} style={{ width: ECRAN.l, height: ECRAN.h, display: 'block' }} />
      {active && <MiseEnValeur key={active.boite + active.t} marque={active} boite={boiteDe(plan.capture, active.boite)} depuis={frame - active.t} z={cam.z} fps={fps} />}
    </div>
  )
}

function MiseEnValeur({ marque, boite, depuis, z, fps }: { marque: Marque & { t: number }; boite: Boite; depuis: number; z: number; fps: number }) {
  const entree = spring({ frame: depuis, fps, config: { damping: 18, stiffness: 160 } })
  const m = 5
  const r = { x: boite.x - m, y: boite.y - m, w: boite.w + 2 * m, h: boite.h + 2 * m }
  const voile = interpolate(entree, [0, 1], [0, 0.42])
  // Toucher : un cercle qui s'enfonce puis se diffuse.
  const tap = marque.tap ? depuis - 10 : -1
  const pression = tap >= 0 ? interpolate(tap, [0, 4, 10], [1, 0.94, 1], { extrapolateRight: 'clamp' }) : 1
  const onde = tap >= 0 ? interpolate(tap, [0, 22], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }) : 0
  const doigt = marque.tap && tap >= -14 && tap < 26 ? interpolate(tap, [-14, -2, 18, 26], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0
  const cx = boite.x + boite.w / 2
  const cy = boite.y + boite.h / 2
  return (
    <>
      <svg width={ECRAN.l} height={ECRAN.h} style={{ position: 'absolute', left: 0, top: 0 }}>
        <defs>
          <mask id={`trou-${boite.x}-${boite.y}`}>
            <rect width={ECRAN.l} height={ECRAN.h} fill="white" />
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill="black" />
          </mask>
        </defs>
        <rect width={ECRAN.l} height={ECRAN.h} fill={`rgba(17,16,30,${voile})`} mask={`url(#trou-${boite.x}-${boite.y})`} />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill="none" stroke={C.violet} strokeWidth={3 / z} opacity={entree}
          style={{ filter: `drop-shadow(0 0 ${6 / z}px ${C.violetClair})`, transformOrigin: `${cx}px ${cy}px`, transform: `scale(${interpolate(entree, [0, 1], [1.08, 1]) * pression})` }} />
        {onde > 0 && onde < 1 && <circle cx={cx} cy={cy} r={8 + onde * 34} fill="none" stroke={C.violet} strokeWidth={3 / z} opacity={1 - onde} />}
      </svg>
      {doigt > 0 && (
        <div style={{ position: 'absolute', left: cx - 14, top: cy - 14, width: 28, height: 28, borderRadius: 999, background: 'rgba(255,255,255,.55)', border: `${2.5 / z}px solid ${C.violet}`, boxShadow: '0 4px 14px rgba(0,0,0,.25)', opacity: doigt, transform: `scale(${pression})` }} />
      )}
      {marque.legende && (
        <div style={{
          position: 'absolute', left: Math.min(ECRAN.l - 8, Math.max(8, cx)), top: r.y + r.h + 8 > ECRAN.h - 60 ? r.y - 8 : r.y + r.h + 8,
          transform: `translate(-50%, ${r.y + r.h + 8 > ECRAN.h - 60 ? '-100%' : '0'}) scale(${entree / z})`, transformOrigin: 'top center',
          background: C.violet, color: 'white', fontFamily: POLICE, fontWeight: 700, fontSize: 15, padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 6px 18px rgba(109,75,209,.35)',
        }}>{marque.legende}</div>
      )}
    </>
  )
}

/** La scène « téléphone » d'une partie : enchaîne ses plans. */
export function Telephone({ id, plans }: { id: IdPartie; plans: Plan[] }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const debuts = debutsPlans(id, plans)
  const i = Math.max(0, debuts.filter((d) => frame >= d).length - 1)
  const plan = plans[i]
  const precedent = i > 0 ? plans[i - 1] : null
  const depuis = frame - debuts[i]
  const fondu = precedent ? interpolate(depuis, [0, 9], [0, 1], { extrapolateRight: 'clamp' }) : 1
  const t = precedent ? spring({ frame: depuis, fps, config: { damping: 22, stiffness: 120 } }) : 1
  const a = precedent && !precedent.ordinateur ? camera(precedent) : camera(plan)
  const b = camera(plan)
  const cam = { z: a.z + (b.z - a.z) * t, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t }
  // Entrée du téléphone au début de la partie.
  const entree = spring({ frame, fps, config: { damping: 20, stiffness: 110 } })
  const ordi = plan.ordinateur ? spring({ frame: depuis, fps, config: { damping: 20 } }) : precedent?.ordinateur ? 1 - spring({ frame: depuis, fps, config: { damping: 20 } }) : 0
  const memeEcran = precedent && precedent.capture === plan.capture
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', left: TEL.x - LE / 2 - TEL.bord, top: TEL.haut, width: LE + 2 * TEL.bord, height: HB + HE + 2 * TEL.bord,
        borderRadius: 74, background: '#15151b', boxShadow: '0 40px 90px rgba(32,35,43,.28), inset 0 0 0 3px #3a3a44',
        transform: `translateY(${interpolate(entree, [0, 1], [120, 0])}px) scale(${interpolate(ordi, [0, 1], [1, 0.82])})`, opacity: interpolate(ordi, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' }) * interpolate(entree, [0, 1], [0, 1]),
      }}>
        <div style={{ position: 'absolute', left: TEL.bord, top: TEL.bord, width: LE, height: HB + HE, borderRadius: 58, overflow: 'hidden', background: 'white' }}>
          <BarreEtat />
          <div style={{ position: 'absolute', left: 0, top: HB, width: LE, height: HE, overflow: 'hidden', background: C.fond }}>
            {precedent && fondu < 1 && !precedent.ordinateur && !memeEcran && <div style={{ position: 'absolute', inset: 0, opacity: 1 - fondu }}><Ecran id={id} plan={{ ...precedent, marques: [] }} debut={debuts[i - 1]} cam={cam} /></div>}
            {!plan.ordinateur && <div style={{ position: 'absolute', inset: 0, opacity: memeEcran ? 1 : fondu }}><Ecran id={id} plan={plan} debut={debuts[i]} cam={cam} /></div>}
          </div>
        </div>
      </div>
      {ordi > 0 && <Ordinateur capture={plan.ordinateur ? plan.capture : precedent!.capture} visible={ordi} />}
    </AbsoluteFill>
  )
}

/** Barre d'état iPhone (heure, réseau, batterie) et son îlot. */
function BarreEtat() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: LE, height: HB, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 46px 0', boxSizing: 'border-box', fontFamily: POLICE, fontWeight: 700, fontSize: 25, color: '#111' }}>
      <span>9:41</span>
      <div style={{ position: 'absolute', left: '50%', top: 14, width: 160, height: 44, marginLeft: -80, borderRadius: 30, background: '#0b0b0f' }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="30" height="20" viewBox="0 0 17 11">{[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4.5} y={8 - i * 2.6} width="3" height={3 + i * 2.6} rx="0.8" fill="#111" />)}</svg>
        <svg width="28" height="20" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0Z M3.2 6.6a6.8 6.8 0 0 1 9.6 0l-1.3 1.3a5 5 0 0 0-7 0Z M.8 4.2a10.2 10.2 0 0 1 14.4 0l-1.3 1.3a8.4 8.4 0 0 0-11.8 0Z" fill="#111" /></svg>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><span style={{ width: 40, height: 20, borderRadius: 6, border: '2px solid #999', padding: 2, boxSizing: 'border-box' }}><span style={{ display: 'block', width: '80%', height: '100%', borderRadius: 3, background: '#111' }} /></span><span style={{ width: 3, height: 7, borderRadius: 2, background: '#999' }} /></span>
      </span>
    </div>
  )
}

function Ordinateur({ capture, visible }: { capture: string; visible: number }) {
  const l = 1000
  const h = (l * 1800) / 2880
  return (
    <div style={{ position: 'absolute', left: 540 - l / 2, top: 620, width: l, opacity: visible, transform: `translateY(${(1 - visible) * 80}px) scale(${0.9 + 0.1 * visible})` }}>
      <div style={{ borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 90px rgba(32,35,43,.3)', border: '1px solid #d9dbe3', background: 'white' }}>
        <div style={{ height: 44, background: '#eceef3', display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c }} />)}
        </div>
        <div style={{ position: 'relative' }}>
          <Img src={staticFile(`captures/${capture}.png`)} style={{ width: l, height: h, display: 'block' }} />
          {/* La colonne de gauche (240 px sur 1440) : toutes les rubriques. */}
          <div style={{ position: 'absolute', left: 4, top: 4, width: (l * 240) / 1440 - 8, height: h - 8, borderRadius: 12, border: `4px solid ${C.violet}`, boxShadow: `0 0 24px ${C.violetClair}`, opacity: Math.max(0, visible * 2 - 1) }} />
        </div>
      </div>
      <div style={{ margin: '0 auto', width: l * 1.12, marginLeft: -l * 0.06, height: 26, background: 'linear-gradient(#d6d8df,#b9bcc6)', borderRadius: '0 0 22px 22px' }} />
    </div>
  )
}
