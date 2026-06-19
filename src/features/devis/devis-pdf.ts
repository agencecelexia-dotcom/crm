import { formatDate } from '@/lib/format'
import type { DevisLigne } from '@/types/database'

export interface DevisData {
  numero: string
  date: string // ISO
  dateValidite?: string | null
  vendeur: {
    nom: string
    adresse?: string | null
    cp?: string | null
    ville?: string | null
    siren?: string | null
    forme?: string | null
    tel?: string | null
    email?: string | null
  }
  client: {
    nom?: string | null
    adresse?: string | null
    cp?: string | null
    ville?: string | null
    tel?: string | null
    email?: string | null
  }
  objet?: string | null
  lignes: DevisLigne[]
  total: number
  acomptePct?: number | null
  conditions?: string | null
}

const NAVY: [number, number, number] = [31, 58, 95]
const ORANGE: [number, number, number] = [234, 88, 12]
const GRIS: [number, number, number] = [70, 70, 70]
const GRIS_CLAIR: [number, number, number] = [120, 120, 120]
const BORD: [number, number, number] = [208, 208, 208]

const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0)
    // Intl FR sépare les milliers par une espace fine insécable (U+202F) absente
    // de la police Helvetica de jsPDF → s'affiche en barre. On met une espace simple.
    .replace(/[\u202f\u00a0]/g, ' ') + ' €'

function chargerImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Construit le document jsPDF du devis (logo Metbach + tableau + totaux). */
export async function construireDevis(data: DevisData, logoUrl = '/logo-metbach.png') {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const F = 'helvetica'
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 15
  const largeur = pageW - margin * 2
  let y = margin

  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])

  // ---------- En-tête : logo + société (droite) ----------
  const logo = await chargerImage(logoUrl)
  if (logo) {
    const w = 45
    const h = (logo.height / logo.width) * w
    try {
      doc.addImage(logo, 'PNG', margin, y, w, h)
    } catch {
      /* ignore */
    }
  }
  // Bloc société à droite
  const v = data.vendeur
  doc.setFontSize(13)
  doc.setFont(F, 'bold')
  setColor(NAVY)
  doc.text(v.nom, pageW - margin, y + 4, { align: 'right' })
  doc.setFont(F, 'normal')
  doc.setFontSize(9)
  setColor(GRIS)
  const infos = [
    v.adresse,
    [v.cp, v.ville].filter(Boolean).join(' '),
    v.forme,
    v.siren ? `SIREN ${v.siren}` : null,
    v.tel,
    v.email,
  ].filter(Boolean) as string[]
  let yy = y + 9
  for (const ln of infos) {
    doc.text(ln, pageW - margin, yy, { align: 'right' })
    yy += 4
  }
  y = Math.max(y + 30, yy + 2)

  // Filet orange
  doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2])
  doc.setLineWidth(0.8)
  doc.line(margin, y, pageW - margin, y)
  y += 8

  // ---------- Titre DEVIS + méta (droite) / client (gauche) ----------
  const blocTop = y
  doc.setFont(F, 'bold')
  doc.setFontSize(22)
  setColor(NAVY)
  doc.text('DEVIS', margin, y + 6)

  doc.setFontSize(9.5)
  setColor(GRIS)
  doc.setFont(F, 'normal')
  const meta = [
    `N° ${data.numero}`,
    `Date : ${formatDate(data.date)}`,
    data.dateValidite ? `Validité : ${formatDate(data.dateValidite)}` : null,
  ].filter(Boolean) as string[]
  let my = blocTop
  for (const ln of meta) {
    doc.text(ln, pageW - margin, my, { align: 'right' })
    my += 4.5
  }
  y += 14

  // Bloc client (encadré léger)
  const c = data.client
  const clientLignes = [
    c.nom,
    c.adresse,
    [c.cp, c.ville].filter(Boolean).join(' '),
    c.tel,
    c.email,
  ].filter(Boolean) as string[]
  doc.setDrawColor(BORD[0], BORD[1], BORD[2])
  doc.setLineWidth(0.2)
  const boxH = 8 + clientLignes.length * 4.5
  doc.roundedRect(margin, y, 95, boxH, 1.5, 1.5)
  doc.setFont(F, 'bold')
  doc.setFontSize(8.5)
  setColor(GRIS_CLAIR)
  doc.text('CLIENT', margin + 3, y + 5)
  doc.setFont(F, 'normal')
  doc.setFontSize(10)
  setColor(GRIS)
  let cy = y + 10
  clientLignes.forEach((ln, i) => {
    doc.setFont(F, i === 0 ? 'bold' : 'normal')
    doc.text(ln, margin + 3, cy)
    cy += 4.5
  })
  y += boxH + 8

  // Objet
  if (data.objet) {
    doc.setFont(F, 'bold')
    doc.setFontSize(10)
    setColor(NAVY)
    doc.text('Objet : ', margin, y)
    const w = doc.getTextWidth('Objet : ')
    doc.setFont(F, 'normal')
    setColor(GRIS)
    for (const ln of doc.splitTextToSize(data.objet, largeur - w)) {
      doc.text(ln, margin + w, y)
      y += 5
    }
    y += 3
  }

  // ---------- Tableau des lignes ----------
  const cols = [
    { key: 'designation', label: 'Désignation', w: 92, align: 'left' as const },
    { key: 'quantite', label: 'Qté', w: 16, align: 'right' as const },
    { key: 'unite', label: 'Unité', w: 20, align: 'left' as const },
    { key: 'pu', label: 'P.U.', w: 26, align: 'right' as const },
    { key: 'total', label: 'Total', w: 26, align: 'right' as const },
  ]
  const xOf = (i: number) => margin + cols.slice(0, i).reduce((s, col) => s + col.w, 0)

  // En-tête tableau
  const drawHead = () => {
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2])
    doc.rect(margin, y, largeur, 8, 'F')
    doc.setFont(F, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(255, 255, 255)
    cols.forEach((col, i) => {
      const cx = col.align === 'right' ? xOf(i) + col.w - 2 : xOf(i) + 2
      doc.text(col.label, cx, y + 5.4, { align: col.align })
    })
    y += 8
  }
  ensure(20)
  drawHead()

  doc.setFontSize?.(9.5)
  for (const l of data.lignes) {
    const desigLines = doc.splitTextToSize(l.designation || '—', cols[0].w - 4)
    const rowH = Math.max(7, desigLines.length * 4.4 + 2.6)
    if (y + rowH > pageH - margin) {
      doc.addPage()
      y = margin
      drawHead()
    }
    const ligneTotal = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0)
    doc.setFont(F, 'normal')
    doc.setFontSize(9.5)
    setColor(GRIS)
    // designation (multi-ligne)
    let dy = y + 4.6
    for (const dl of desigLines) {
      doc.text(dl, xOf(0) + 2, dy)
      dy += 4.4
    }
    const midY = y + 4.6
    doc.text(String(l.quantite ?? ''), xOf(1) + cols[1].w - 2, midY, { align: 'right' })
    doc.text(l.unite || '', xOf(2) + 2, midY)
    doc.text(eur(Number(l.prix_unitaire) || 0), xOf(3) + cols[3].w - 2, midY, { align: 'right' })
    doc.setFont(F, 'bold')
    doc.text(eur(ligneTotal), xOf(4) + cols[4].w - 2, midY, { align: 'right' })
    // bordure bas
    doc.setDrawColor(BORD[0], BORD[1], BORD[2])
    doc.setLineWidth(0.2)
    doc.line(margin, y + rowH, pageW - margin, y + rowH)
    y += rowH
  }
  y += 6

  // ---------- Totaux (franchise TVA) ----------
  ensure(34)
  const boxW = 80
  const bx = pageW - margin - boxW
  doc.setFont(F, 'normal')
  doc.setFontSize(9)
  setColor(GRIS_CLAIR)
  doc.text('TVA non applicable, art. 293 B du CGI', bx, y)
  y += 7
  doc.setFillColor(245, 243, 255)
  doc.rect(bx, y, boxW, 11, 'F')
  doc.setFont(F, 'bold')
  doc.setFontSize(12)
  setColor(NAVY)
  doc.text('NET À PAYER', bx + 3, y + 7)
  doc.text(eur(data.total), pageW - margin - 3, y + 7, { align: 'right' })
  y += 16

  if (data.acomptePct && data.acomptePct > 0) {
    const ac = (data.total * data.acomptePct) / 100
    doc.setFont(F, 'normal')
    doc.setFontSize(9.5)
    setColor(GRIS)
    doc.text(
      `Acompte à la commande (${data.acomptePct}%) : ${eur(ac)} — Solde : ${eur(data.total - ac)}`,
      margin,
      y,
    )
    y += 7
  }

  // Conditions
  if (data.conditions) {
    ensure(20)
    doc.setFont(F, 'bold')
    doc.setFontSize(9.5)
    setColor(NAVY)
    doc.text('Conditions', margin, y)
    y += 5
    doc.setFont(F, 'normal')
    setColor(GRIS)
    for (const ln of doc.splitTextToSize(data.conditions, largeur)) {
      ensure(4.5)
      doc.text(ln, margin, y)
      y += 4.5
    }
    y += 4
  }

  // Bon pour accord
  ensure(30)
  y += 4
  doc.setFont(F, 'normal')
  doc.setFontSize(9.5)
  setColor(GRIS)
  doc.text('Bon pour accord (date et signature du client) :', pageW - margin - 80, y)
  doc.setDrawColor(BORD[0], BORD[1], BORD[2])
  doc.roundedRect(pageW - margin - 80, y + 3, 80, 22, 1.5, 1.5)

  // Pied de page (mentions) sur chaque page
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont(F, 'normal')
    doc.setFontSize(7.5)
    setColor(GRIS_CLAIR)
    const pied = [
      v.nom,
      v.forme,
      v.siren ? `SIREN ${v.siren}` : null,
      [v.cp, v.ville].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(' — ')
    doc.text(pied, pageW / 2, pageH - 8, { align: 'center', maxWidth: largeur })
  }

  return doc
}

/** Télécharge le devis (PDF). */
export async function telechargerDevis(data: DevisData) {
  const doc = await construireDevis(data)
  doc.save(`devis-${data.numero}.pdf`)
}

/** Renvoie le devis sous forme de Blob (pour l'upload). */
export async function devisEnBlob(data: DevisData): Promise<Blob> {
  const doc = await construireDevis(data)
  return doc.output('blob')
}
