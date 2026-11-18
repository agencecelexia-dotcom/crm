import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { phrases, quand } from '../temps'
import { C, POLICE, POLICE_TITRE } from '../theme'
import { Logo } from './Habillage'

// Icônes au trait (dessin Lucide, celui du CRM).
const TRACES: Record<string, ReactNode> = {
  tel: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  ok: <path d="M20 6 9 17l-5-5" />,
  non: <path d="M18 6 6 18M6 6l12 12" />,
  cadenas: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  agenda: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  devis: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></>,
  signe: <><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></>,
  hausse: <><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></>,
  aide: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24" /></>,
  plus: <path d="M5 12h14M12 5v14" />,
  note: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
}
export function Icone({ nom, taille = 32, couleur = 'currentColor', epaisseur = 2 }: { nom: keyof typeof TRACES; taille?: number; couleur?: string; epaisseur?: number }) {
  return <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round">{TRACES[nom]}</svg>
}

/** Apparition « ressort » à partir de l'image `t`. */
function useEntree(t: number, raideur = 140) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - t, fps, config: { damping: 16, stiffness: raideur } })
}
const apparait = (e: number, dy = 40): CSSProperties => ({ opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * dy}px) scale(${0.92 + 0.08 * e})` })

function SousTitre({ id, top }: { id: 'bienvenue'; top: number }) {
  const frame = useCurrentFrame()
  const p = phrases(id).filter((x) => frame >= x.debut - 3).at(-1)
  if (!p) return null
  return <p key={p.debut} style={{ position: 'absolute', left: 90, right: 90, top, margin: 0, textAlign: 'center', fontFamily: POLICE, fontWeight: 500, fontSize: 34, lineHeight: 1.4, color: C.doux, opacity: interpolate(frame - p.debut, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{p.texte}</p>
}

// ———————————————————————— 1. Bienvenue ————————————————————————
export function Bienvenue() {
  const logo = useEntree(4)
  const titre = useEntree(18)
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 150, width: '100%', display: 'flex', justifyContent: 'center', ...apparait(logo, -30) }}><Logo largeur={400} /></div>
      <div style={{ position: 'absolute', top: 1010, width: '100%', textAlign: 'center', ...apparait(titre) }}>
        <div style={{ fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 92, letterSpacing: -2, color: C.texte, lineHeight: 1 }}>Votre espace artisan</div>
        <div style={{ marginTop: 18, fontFamily: POLICE, fontWeight: 600, fontSize: 36, color: C.violet }}>Le mode d’emploi, en 4 minutes</div>
      </div>
      <SousTitre id="bienvenue" top={1300} />
    </AbsoluteFill>
  )
}

// ———————————————————————— 2. Pourquoi ————————————————————————
function Carte({ t, icone, texte, style }: { t: number; icone: keyof typeof TRACES; texte: string; style?: CSSProperties }) {
  const e = useEntree(t, 170)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '30px 30px', borderRadius: 26, background: 'white', border: '1px solid #e4e5ec', boxShadow: '0 14px 34px rgba(32,35,43,.08)', ...apparait(e), ...style }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 72, height: 72, borderRadius: 20, background: C.violetPale, flexShrink: 0 }}><Icone nom={icone} taille={36} couleur={C.violet} /></span>
      <span style={{ fontFamily: POLICE, fontWeight: 700, fontSize: 36, color: C.texte, lineHeight: 1.2 }}>{texte}</span>
    </div>
  )
}

export function Pourquoi() {
  const frame = useCurrentFrame()
  const t2 = quand('pourquoi', 'Si vous le notez') - 4
  const t3 = quand('pourquoi', 'Et soyons clairs') - 4
  const sortie1 = interpolate(frame, [t2 - 6, t2 + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const sortie2 = interpolate(frame, [t3 - 6, t3 + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const intro = useEntree(quand('pourquoi', 'Nous vous envoyons'))
  const avant = useEntree(t2 + 4)
  const apres = useEntree(quand('pourquoi', 'on n’a plus besoin'))
  const tranquilles = ['Vous', 'Celexia', 'Le client']
  const fin = useEntree(t3 + 4)
  const chiffre = useEntree(t3 + 22, 90)
  return (
    <AbsoluteFill>
      {frame < t2 + 8 && (
        <div style={{ position: 'absolute', left: 70, right: 70, top: 560, opacity: sortie1 }}>
          <p style={{ margin: 0, fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 56, lineHeight: 1.1, color: C.texte, ...apparait(intro) }}>Nous devons savoir<br />où vous en êtes.</p>
          <div style={{ marginTop: 80, display: 'grid', gap: 40 }}>
            <Carte t={quand('pourquoi', 'client appelé')} icone="tel" texte="Client appelé ?" />
            <Carte t={quand('pourquoi', 'Rendez-vous pris')} icone="agenda" texte="Rendez-vous pris ?" />
            <Carte t={quand('pourquoi', 'Devis parti')} icone="devis" texte="Devis parti ?" />
            <Carte t={quand('pourquoi', 'Signé ?')} icone="signe" texte="Signé ?" />
          </div>
        </div>
      )}
      {frame >= t2 - 6 && frame < t3 + 8 && (
        <div style={{ position: 'absolute', left: 70, right: 70, top: 600, opacity: sortie2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26, padding: 34, borderRadius: 28, background: '#fff5f5', border: '1px solid #f3cccc', ...apparait(avant) }}>
            <span style={{ position: 'relative', display: 'grid', placeItems: 'center', width: 92, height: 92, borderRadius: 24, background: '#fde2e2' }}>
              <Icone nom="tel" taille={44} couleur="#b42318" />
              <span style={{ position: 'absolute', right: -10, top: -10, display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 99, background: '#b42318' }}><Icone nom="non" taille={24} couleur="white" epaisseur={3} /></span>
            </span>
            <span style={{ fontFamily: POLICE, fontWeight: 700, fontSize: 38, color: '#7a1d14', lineHeight: 1.2, textDecoration: apres > 0.5 ? 'line-through' : 'none' }}>Les appels pour savoir<br />« où en est-on ? »</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 44, padding: 34, borderRadius: 28, background: 'white', border: `2px solid ${C.violet}`, boxShadow: '0 20px 44px rgba(109,75,209,.18)', ...apparait(apres) }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 92, height: 92, borderRadius: 24, background: C.violet }}><Icone nom="note" taille={44} couleur="white" /></span>
            <span style={{ fontFamily: POLICE, fontWeight: 700, fontSize: 38, color: C.texte, lineHeight: 1.2 }}>Noté dans votre espace :<br /><span style={{ color: C.violet }}>Celexia est informé en direct</span></span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 190 }}>
            {tranquilles.map((nom, i) => <Tranquille key={nom} nom={nom} t={quand('pourquoi', 'Vous êtes tranquille') + i * 9} />)}
          </div>
        </div>
      )}
      {frame >= t3 - 6 && (
        <div style={{ position: 'absolute', left: 70, right: 70, top: 620, textAlign: 'center' }}>
          <div style={{ ...apparait(fin), fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 84, lineHeight: 1.05, color: C.texte, letterSpacing: -1.5 }}>Un espace à jour</div>
          <div style={{ ...apparait(fin), margin: '34px auto', display: 'grid', placeItems: 'center', width: 110, height: 110, borderRadius: 999, background: C.violetPale }}><Icone nom="hausse" taille={56} couleur={C.violet} epaisseur={2.4} /></div>
          <div style={{ ...apparait(chiffre), fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 92, lineHeight: 1.05, color: C.violet, letterSpacing: -1.5 }}>= plus de chantiers</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 22, height: 300, marginTop: 70 }}>
            {[0.3, 0.45, 0.62, 0.8, 1].map((h, i) => <Barre key={i} hauteur={h} t={t3 + 26 + i * 5} />)}
          </div>
        </div>
      )}
    </AbsoluteFill>
  )
}

function Tranquille({ nom, t }: { nom: string; t: number }) {
  const e = useEntree(t, 180)
  return (
    <div style={{ width: 280, textAlign: 'center', ...apparait(e, 30) }}>
      <div style={{ margin: '0 auto', display: 'grid', placeItems: 'center', width: 170, height: 170, borderRadius: 999, background: '#e8f6ee', border: '4px solid #9fd8b4' }}><Icone nom="ok" taille={84} couleur={C.vert} epaisseur={2.8} /></div>
      <div style={{ marginTop: 24, fontFamily: POLICE, fontWeight: 700, fontSize: 40, color: C.texte }}>{nom}</div>
      <div style={{ fontFamily: POLICE, fontSize: 30, color: C.doux }}>tranquille</div>
    </div>
  )
}

function Barre({ hauteur, t }: { hauteur: number; t: number }) {
  const e = useEntree(t, 110)
  return <div style={{ width: 92, height: 300 * hauteur * e, borderRadius: '18px 18px 6px 6px', background: `linear-gradient(${C.violetClair}, ${C.violet})` }} />
}

// ———————————————————————— 3. Le lien ————————————————————————
export function Lien() {
  const frame = useCurrentFrame()
  const lien = useEntree(quand('lien', 'Votre espace'))
  const icone = useEntree(quand('lien', 'ajoutez-le'), 200)
  const mail = useEntree(quand('lien', 'Perdu'), 150)
  const garde = useEntree(quand('lien', 'ne le partagez pas'), 170)
  const l = 560
  const h = 1120
  const apps = Array.from({ length: 16 }, (_, i) => i)
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 540 - l / 2 - 14, top: 560, width: l + 28, height: h + 28, borderRadius: 70, background: '#15151b', boxShadow: '0 40px 90px rgba(32,35,43,.28)', ...apparait(lien, 80) }}>
        <div style={{ position: 'absolute', left: 14, top: 14, width: l, height: h, borderRadius: 56, overflow: 'hidden', background: 'linear-gradient(160deg, #8b6cf0 0%, #6d4bd1 45%, #2c1f63 100%)' }}>
          <div style={{ position: 'absolute', left: '50%', top: 16, width: 150, height: 42, marginLeft: -75, borderRadius: 30, background: '#0b0b0f' }} />
          <div style={{ position: 'absolute', top: 150, left: 46, right: 46, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', rowGap: 52, columnGap: 30 }}>
            {apps.map((i) => i === 5 ? (
              <div key={i} style={{ textAlign: 'center', transform: `scale(${icone})`, opacity: icone }}>
                <Img src={staticFile('icone.png')} style={{ width: 96, height: 96, borderRadius: 24, boxShadow: '0 10px 24px rgba(0,0,0,.35)' }} />
                <div style={{ marginTop: 8, fontFamily: POLICE, fontWeight: 600, fontSize: 20, color: 'white' }}>Celexia</div>
              </div>
            ) : (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ width: 96, height: 96, borderRadius: 24, background: 'rgba(255,255,255,.16)' }} />
                <div style={{ margin: '12px auto 0', width: 60, height: 10, borderRadius: 9, background: 'rgba(255,255,255,.18)' }} />
              </div>
            ))}
          </div>
          {/* Notification de l'email de renvoi du lien */}
          <div style={{ position: 'absolute', left: 22, right: 22, top: 74, padding: '20px 22px', borderRadius: 26, background: 'rgba(255,255,255,.94)', boxShadow: '0 14px 30px rgba(0,0,0,.25)', display: 'flex', gap: 16, alignItems: 'center', opacity: mail, transform: `translateY(${(1 - mail) * -160}px)` }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, borderRadius: 16, background: C.violet, flexShrink: 0 }}><Icone nom="mail" taille={30} couleur="white" /></span>
            <span style={{ fontFamily: POLICE, color: C.texte, lineHeight: 1.25 }}><b style={{ fontSize: 22 }}>Celexia</b><br /><span style={{ fontSize: 21 }}>Votre lien d’accès à votre espace Celexia</span></span>
          </div>
        </div>
      </div>
      {/* Le lien lui-même, au-dessus */}
      <div style={{ position: 'absolute', top: 470, left: 0, right: 0, display: 'flex', justifyContent: 'center', ...apparait(lien, 30) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 30px', borderRadius: 999, background: 'white', border: '1px solid #e4e5ec', boxShadow: '0 12px 30px rgba(32,35,43,.1)', fontFamily: POLICE, fontSize: 30, color: C.texte }}>
          <Icone nom="cadenas" taille={30} couleur={C.violet} /> <span>…/artisan/<b style={{ letterSpacing: 2 }}>••••••••</b></span>
        </div>
      </div>
      {frame >= quand('lien', 'ne le partagez pas') - 2 && (
        <div style={{ position: 'absolute', top: 1500, left: 0, right: 0, display: 'flex', justifyContent: 'center', ...apparait(garde, 30) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '22px 34px', borderRadius: 999, background: '#b42318', color: 'white', fontFamily: POLICE, fontWeight: 700, fontSize: 34, boxShadow: '0 16px 36px rgba(180,35,24,.35)' }}>
            <Icone nom="cadenas" taille={34} couleur="white" /> Personnel : ne le partagez pas
          </div>
        </div>
      )}
    </AbsoluteFill>
  )
}

// ———————————————————————— 14. Les 3 réflexes ————————————————————————
const REFLEXES = [
  { mot: 'Un :', icone: 'tel', titre: 'Appeler chaque nouveau client', detail: 'sous 48 heures' },
  { mot: 'Deux :', icone: 'note', titre: 'Mettre à jour après chaque échange', detail: 'l’étape, ou une note' },
  { mot: 'Trois :', icone: 'devis', titre: 'Déposer vos devis', detail: 'et le devis signé dès la signature' },
] as const

export function Reflexes() {
  const frame = useCurrentFrame()
  const tFin = quand('reflexes', 'Une question') - 4
  const sortie = interpolate(frame, [tFin - 4, tFin + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const merci = useEntree(quand('reflexes', 'Merci'))
  const aide = useEntree(quand('reflexes', '« Aide et contact »'), 170)
  return (
    <AbsoluteFill>
      {frame < tFin + 10 && (
        <div style={{ position: 'absolute', left: 70, right: 70, top: 520, display: 'grid', gap: 34, opacity: sortie }}>
          {REFLEXES.map((r, i) => <Reflexe key={r.mot} n={i + 1} {...r} t={quand('reflexes', r.mot)} />)}
        </div>
      )}
      {frame >= tFin && (
        <>
          <div style={{ position: 'absolute', top: 1040, width: '100%', textAlign: 'center', ...apparait(aide, 30) }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '18px 32px', borderRadius: 999, background: 'white', border: '1px solid #e4e5ec', fontFamily: POLICE, fontWeight: 600, fontSize: 32, color: C.texte, boxShadow: '0 12px 30px rgba(32,35,43,.1)' }}>
              <Icone nom="aide" taille={32} couleur={C.violet} /> Une question ? Aide et contact
            </span>
          </div>
          <div style={{ position: 'absolute', top: 1190, width: '100%', textAlign: 'center', ...apparait(merci) }}>
            <div style={{ fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 88, letterSpacing: -1.5, color: C.texte, lineHeight: 1.05 }}>Merci, et<br />bons chantiers !</div>
            <div style={{ marginTop: 70, display: 'flex', justifyContent: 'center' }}><Logo largeur={340} /></div>
          </div>
        </>
      )}
    </AbsoluteFill>
  )
}

function Reflexe({ n, icone, titre, detail, t }: { n: number; icone: keyof typeof TRACES; titre: string; detail: string; t: number }) {
  const e = useEntree(t, 150)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 30, padding: '36px 34px', borderRadius: 30, background: 'white', border: '1px solid #e4e5ec', boxShadow: '0 16px 40px rgba(32,35,43,.08)', ...apparait(e, 60) }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 104, height: 104, borderRadius: 999, background: C.violet, color: 'white', fontFamily: POLICE_TITRE, fontWeight: 600, fontSize: 56, flexShrink: 0 }}>{n}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontFamily: POLICE, fontWeight: 700, fontSize: 38, color: C.texte, lineHeight: 1.15 }}>{titre}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontFamily: POLICE, fontWeight: 500, fontSize: 30, color: C.violet }}><Icone nom={icone} taille={28} couleur={C.violet} /> {detail}</span>
      </span>
    </div>
  )
}
