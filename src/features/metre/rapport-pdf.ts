import { formatDate } from '@/lib/format'
import { geometrieCroquis, geometrieElevation } from './croquis'
import { formatM, formatM2 } from './geometrie'
import type { RapportMetre } from './rapport-metre'
import { facadeRetenue, type Releve } from './releve'

/**
 * Le rapport de métré en PDF : la maison (vue 3D, plan coté), puis les
 * tableaux — toiture pan par pan, linéaires, façades brute / ouvertures /
 * nette, matériaux —, les élévations, et les sources. Mêmes couleurs et même
 * police que le devis (`devis-pdf.ts`).
 */
const NAVY: [number, number, number] = [31, 58, 95]
const ORANGE: [number, number, number] = [234, 88, 12]
const GRIS: [number, number, number] = [70, 70, 70]
const GRIS_CLAIR: [number, number, number] = [120, 120, 120]
const BORD: [number, number, number] = [208, 208, 208]
const FOND: [number, number, number] = [245, 247, 250]

// La police Helvetica de jsPDF ne connaît que le jeu Windows-1252 : les
// espaces fines d'Intl s'y impriment en barre, le signe moins et « ≈ » en
// points d'interrogation.
const net = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ').replace(/\u2212/g, '-').replace(/\u2248/g, '~')

/** Un nombre de m² sans « m² » (la colonne le dit), au dixième : un rapport se recoupe. */
const m2 = (n: number | null) => (n == null ? '—' : n.toFixed(1).replace('.', ','))
const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')} %`

export async function construireRapport(r: RapportMetre, releve: Releve, image3d: string | null) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const F = 'helvetica'
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marge = 15
  const largeur = pageW - marge * 2
  let y = marge

  const couleur = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const assurer = (h: number) => {
    if (y + h > pageH - marge - 6) {
      doc.addPage()
      y = marge
    }
  }
  const texte = (t: string, x: number, yy: number, o?: Parameters<typeof doc.text>[3]) => doc.text(net(t), x, yy, o)
  const titreSection = (t: string) => {
    assurer(14)
    y += 3
    doc.setFont(F, 'bold')
    doc.setFontSize(11)
    couleur(NAVY)
    texte(t.toUpperCase(), marge, y)
    y += 2
    doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2])
    doc.setLineWidth(0.4)
    doc.line(marge, y, marge + 22, y)
    y += 5
  }

  /** Un tableau simple : en-tête gras sur fond gris, lignes filetées, nombres à droite. */
  const tableau = (entetes: string[], lignes: string[][], largeurs: number[], droite: boolean[], gras: boolean[] = []) => {
    const h = 6.2
    // L'abscisse de chaque colonne : la somme des largeurs avant elle.
    const xs = largeurs.map((_, i) => marge + largeurs.slice(0, i).reduce((a, b) => a + b, 0))
    const ligne = (cells: string[], entete: boolean, fort: boolean) => {
      assurer(h)
      if (entete) {
        doc.setFillColor(FOND[0], FOND[1], FOND[2])
        doc.rect(marge, y - 4.3, largeur, h, 'F')
      }
      doc.setFont(F, entete || fort ? 'bold' : 'normal')
      doc.setFontSize(entete ? 8 : 9)
      couleur(entete ? GRIS_CLAIR : GRIS)
      cells.forEach((c, i) => {
        const w = largeurs[i] - 3
        const t = doc.splitTextToSize(net(c), w)[0] ?? ''
        if (droite[i]) doc.text(t, xs[i] + largeurs[i] - 1.5, y, { align: 'right' })
        else doc.text(t, xs[i] + 1.5, y)
      })
      doc.setDrawColor(BORD[0], BORD[1], BORD[2])
      doc.setLineWidth(0.15)
      doc.line(marge, y + 1.9, marge + largeur, y + 1.9)
      y += h
    }
    ligne(entetes, true, false)
    lignes.forEach((l, i) => ligne(l, false, gras[i] ?? false))
    y += 2
  }

  // ---------- En-tête ----------
  doc.setFont(F, 'bold')
  doc.setFontSize(20)
  couleur(NAVY)
  texte('MÉTRÉ', marge, y + 6)
  doc.setFont(F, 'normal')
  doc.setFontSize(9.5)
  couleur(GRIS)
  texte(`Établi le ${formatDate(r.date.toISOString())}`, pageW - marge, y + 2, { align: 'right' })
  texte('Mesuré à distance, à confirmer sur place', pageW - marge, y + 6.5, { align: 'right' })
  y += 12
  doc.setFont(F, 'bold')
  doc.setFontSize(11)
  couleur(GRIS)
  if (r.titre) {
    texte(r.titre, marge, y)
    y += 5
  }
  doc.setFont(F, 'normal')
  doc.setFontSize(9.5)
  if (r.adresse) {
    texte(r.adresse, marge, y)
    y += 5
  }
  doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2])
  doc.setLineWidth(0.8)
  doc.line(marge, y, pageW - marge, y)
  y += 7

  // ---------- Les chiffres clés ----------
  const cles: [string, string, string][] = [
    ['Toiture', formatM2(r.toiture.surface), `${r.toiture.nombre} pans, pente ${pct(r.toiture.penteDesPans)}`],
    [
      'Façades',
      formatM2(r.totalFacades.nette ?? r.totalFacades.brute),
      r.totalFacades.nette != null ? `nettes (brutes ${formatM2(r.totalFacades.brute)})` : 'brutes, ouvertures non déduites',
    ],
    ['Hauteur', r.hauteurs.gouttiere != null ? formatM(r.hauteurs.gouttiere) : '—', 'à la gouttière'],
  ]
  const wCle = (largeur - 8) / 3
  cles.forEach(([t, v, d], i) => {
    const x = marge + i * (wCle + 4)
    doc.setDrawColor(BORD[0], BORD[1], BORD[2])
    doc.setLineWidth(0.2)
    doc.roundedRect(x, y, wCle, 20, 1.5, 1.5)
    doc.setFont(F, 'bold')
    doc.setFontSize(8)
    couleur(GRIS_CLAIR)
    texte(t.toUpperCase(), x + 3, y + 5)
    doc.setFontSize(14)
    couleur(NAVY)
    texte(v, x + 3, y + 12)
    doc.setFont(F, 'normal')
    doc.setFontSize(7.5)
    couleur(GRIS)
    texte(doc.splitTextToSize(net(d), wCle - 6)[0] ?? '', x + 3, y + 17)
  })
  y += 26

  // ---------- La maison : vue 3D et plan coté ----------
  const plan = geometrieCroquis(releve.murs, 320, 34)
  const hBloc = 78
  if (image3d || plan) {
    assurer(hBloc)
    const wImage = image3d && plan ? largeur * 0.55 : largeur
    if (image3d) {
      const props = doc.getImageProperties(image3d)
      const w = Math.min(wImage, (hBloc * props.width) / props.height)
      const h = (w * props.height) / props.width
      doc.addImage(image3d, 'PNG', marge, y, w, h)
    }
    if (plan) {
      const x0 = image3d ? marge + wImage + 4 : marge
      const place = image3d ? largeur - wImage - 4 : largeur
      const k = Math.min(place / plan.largeur, hBloc / plan.hauteur)
      const P = (p: [number, number]): [number, number] => [x0 + p[0] * k, y + p[1] * k]
      doc.setDrawColor(124, 58, 237)
      doc.setLineWidth(0.5)
      const pts = plan.contour.map(P)
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        doc.line(a[0], a[1], b[0], b[1])
      }
      doc.setFont(F, 'normal')
      doc.setFontSize(7)
      couleur(GRIS)
      for (const c of plan.cotes) {
        if (c.longueur < 1.5) continue
        const [x, yy] = P(c.etiquette)
        // La cote s'écrit vers l'extérieur : à gauche d'un mur de gauche, à droite d'un mur de droite.
        const dx = c.etiquette[0] - (c.a[0] + c.b[0]) / 2
        const align = dx < -3 ? 'right' : dx > 3 ? 'left' : 'center'
        texte(formatM(c.longueur), x, yy + 1, { align })
      }
      // Le nord, en haut du plan.
      doc.setFont(F, 'bold')
      texte('N', x0 + plan.largeur * k - 3, y + 3)
    }
    y += hBloc + 4
  }

  // ---------- Toiture ----------
  titreSection('Toiture')
  tableau(
    ['Pan', 'Pente', 'Surface (m²)', 'Compté'],
    [
      ...r.toiture.pans.map((p) => [p.nom, p.terrasse ? '—' : `${p.pente} %`, m2(p.surface), p.retenu ? 'oui' : 'non']),
      ['Total compté', pct(r.toiture.penteDesPans), m2(r.toiture.surface), ''],
    ],
    [80, 30, 40, 30],
    [false, true, true, true],
    [...r.toiture.pans.map(() => false), true],
  )
  doc.setFont(F, 'normal')
  doc.setFontSize(8.5)
  couleur(GRIS)
  const aCommander = [5, 10, 15].map((c) => `${formatM2(r.toiture.surface * (1 + c / 100))} (+${c} %)`).join(' · ')
  texte(`Surface vraie, pente comprise${r.toiture.debord ? `, débord mesuré : ${r.toiture.debord}` : ''}. À commander, chutes comprises : ${aCommander}.`, marge, y, { maxWidth: largeur })
  y += 9

  if (r.lineaires.length) {
    titreSection('Linéaires')
    tableau(
      ['Ligne', 'Tronçons', 'Longueur (ml)'],
      r.lineaires.map((l) => [l.libelle, String(l.nombre), formatM(l.longueur).replace(' m', '')]),
      [100, 35, 45],
      [false, true, true],
    )
  }

  // ---------- Façades ----------
  titreSection('Façades')
  tableau(
    ['Façade', 'Longueur', 'Hauteur', 'Brute (m²)', 'Ouvertures', 'Nette (m²)'],
    [
      ...r.facades.map((f) => [
        `${f.orientation}${f.rue ? ' (rue)' : ''}${f.retrait ? ' (retrait)' : ''}`,
        f.brute > 0 ? formatM(f.longueur) : 'mitoyenne',
        f.hauteurMax - f.hauteurMin < 0.3 ? formatM(f.hauteurMin) : `${formatM(f.hauteurMin)} à ${formatM(f.hauteurMax)}`,
        m2(f.brute),
        f.ouvertures ? `${f.ouvertures.nombre} · ${m2(f.ouvertures.surface)} m²` : f.brute > 0 ? 'non lues' : '—',
        m2(f.nette),
      ]),
      ['Total', '', '', m2(r.totalFacades.brute), r.totalFacades.ouvertures ? `${m2(r.totalFacades.ouvertures)} m²` : '', m2(r.totalFacades.nette)],
    ],
    [38, 26, 34, 26, 32, 24],
    [false, true, true, true, true, true],
    [...r.facades.map(() => false), true],
  )
  doc.setFont(F, 'normal')
  doc.setFontSize(8.5)
  couleur(GRIS)
  texte(
    'Brute : mur relevé hors partie mitoyenne. Ouvertures : lues sur la photo de la façade. Nette : brute moins ouvertures ; « non lues » tant que la façade n’a pas de photo lue.',
    marge,
    y,
    { maxWidth: largeur },
  )
  y += 10

  // ---------- Matériaux ----------
  if (r.materiaux.toit || r.materiaux.murs) {
    titreSection('Matériaux')
    tableau(
      ['Élément', 'Matériau', 'Provenance'],
      [
        ...(r.materiaux.toit ? [['Couverture', r.materiaux.toit.libelle, r.materiaux.toit.provenance]] : []),
        ...r.lignes.filter((l) => l.rubrique === 'Matériaux' && l.quantite != null).map((l) => [l.element, String(l.quantite), l.source]),
        ...(r.materiaux.murs ? [['Murs', r.materiaux.murs.libelle, r.materiaux.murs.provenance]] : []),
      ],
      [40, 60, 80],
      [false, false, false],
    )
  }

  // ---------- Élévations : deux par ligne ----------
  const elevations = r.facades.filter((f) => f.brute > 0)
  if (elevations.length) {
    titreSection('Élévations')
    const colonne = (largeur - 6) / 2
    const HAUT_MAX = 42
    for (let i = 0; i < elevations.length; i += 2) {
      const paire = elevations.slice(i, i + 2).map((f) => ({ f, g: geometrieElevation(facadeRetenue(releve, f.orientation).murs, 320, 110) }))
      // Une seule échelle pour la ligne : deux façades côte à côte se comparent.
      const k = Math.min(...paire.filter((e) => e.g).map((e) => Math.min(colonne / e.g!.largeur, HAUT_MAX / e.g!.hauteur)))
      const h = Math.max(...paire.map((e) => (e.g ? e.g.hauteur * k : 0)))
      assurer(h + 8)
      paire.forEach(({ f, g }, j) => {
        const x0 = marge + j * (colonne + 6)
        doc.setFont(F, 'bold')
        doc.setFontSize(8.5)
        couleur(GRIS)
        texte(`Façade ${f.orientation} — ${formatM2(f.brute)}${f.nette != null ? ` (${formatM2(f.nette)} nette)` : ''}`, x0, y)
        if (!g) return
        const y0 = y + 1
        const P = (p: [number, number]): [number, number] => [x0 + p[0] * k, y0 + p[1] * k]
        doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2])
        doc.setLineWidth(0.3)
        doc.setFont(F, 'normal')
        doc.setFontSize(6.5)
        for (const m of g.murs) {
          const pts = m.contour.map(P)
          for (let n = 0; n < pts.length; n++) {
            const a = pts[n], b = pts[(n + 1) % pts.length]
            doc.line(a[0], a[1], b[0], b[1])
          }
          if (m.cote) texte(formatM(m.cote.texte), ...P([m.cote.x, m.cote.y - 4]), { align: 'center' })
          for (const t of m.hauteurs) texte(formatM(t.texte), ...P([t.x, t.y]))
        }
        doc.setDrawColor(BORD[0], BORD[1], BORD[2])
        doc.line(x0, y0 + g.sol * k, x0 + g.largeur * k, y0 + g.sol * k)
      })
      y += h + 6
    }
  }

  // ---------- Sources ----------
  titreSection('Sources')
  doc.setFont(F, 'normal')
  doc.setFontSize(8)
  couleur(GRIS)
  for (const s of r.sources) {
    const l = doc.splitTextToSize(net(s), largeur) as string[]
    assurer(l.length * 3.8)
    doc.text(l, marge, y)
    y += l.length * 3.8 + 1
  }

  // ---------- Pied de page ----------
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont(F, 'normal')
    doc.setFontSize(7.5)
    couleur(GRIS_CLAIR)
    texte([r.titre, r.adresse].filter(Boolean).join(' — ') || 'Métré', marge, pageH - 8, { maxWidth: largeur - 20 })
    if (total > 1) texte(`${p} / ${total}`, pageW - marge, pageH - 8, { align: 'right' })
  }
  return doc
}

/** Un nom de fichier sans accents ni espaces : « metre-3-chemin-des-muriers.pdf ». */
export function nomDeFichier(r: RapportMetre, extension: string): string {
  const base = (r.adresse ?? r.titre ?? 'maison')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  return `metre-${base || 'maison'}.${extension}`
}

export async function telechargerRapport(r: RapportMetre, releve: Releve, image3d: string | null) {
  const doc = await construireRapport(r, releve, image3d)
  doc.save(nomDeFichier(r, 'pdf'))
}
