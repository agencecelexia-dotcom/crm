import { formatDate } from '@/lib/format'
import { parseContrat } from './contrat-modele'

// Génère et télécharge le contrat au format PDF, mis en forme comme un vrai
// document (titre, sous-titres, articles en gras, paragraphes, définitions,
// bloc signatures 2 colonnes). jsPDF importé dynamiquement (bundle).
export async function telechargerContratPdf(opts: {
  contenu: string // déjà finalisé (date remplie)
  signataire: string | null
  signedAt: string | null
  signatureDataUrl: string | null
  apporteurSignatureUrl?: string | null
}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const FONT = 'times'
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 20
  const largeur = pageW - margin * 2
  let y = margin

  const mm = (pt: number) => pt * 0.3528 // points → mm
  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  // Texte centré (titre / sous-titres)
  function centre(
    text: string,
    { size, style, gapBefore = 0, gapAfter = 1.5, gris = false }: {
      size: number; style: 'normal' | 'bold' | 'italic'; gapBefore?: number; gapAfter?: number; gris?: boolean
    },
  ) {
    y += gapBefore
    doc.setFont(FONT, style)
    doc.setFontSize(size)
    doc.setTextColor(gris ? 110 : 25, gris ? 110 : 25, gris ? 110 : 25)
    const lh = mm(size) * 1.2
    for (const ln of doc.splitTextToSize(text, largeur)) {
      ensure(lh)
      doc.text(ln, pageW / 2, y, { align: 'center' })
      y += lh
    }
    y += gapAfter
  }

  // Texte "riche" aligné à gauche : suite de segments (gras / normal) qui
  // s'enchaînent avec retour à la ligne automatique + saut de page.
  function riche(
    runs: { text: string; bold?: boolean }[],
    { size = 10.5, gapBefore = 0, gapAfter = 2.4 }: { size?: number; gapBefore?: number; gapAfter?: number } = {},
  ) {
    y += gapBefore
    const lh = mm(size) * 1.25
    doc.setFontSize(size)
    doc.setTextColor(25, 25, 25)
    ensure(lh)
    let x = margin
    for (const run of runs) {
      doc.setFont(FONT, run.bold ? 'bold' : 'normal')
      const mots = run.text.split(/(\s+)/)
      for (const mot of mots) {
        if (mot === '') continue
        const w = doc.getTextWidth(mot)
        if (x + w > margin + largeur && mot.trim() !== '') {
          y += lh
          x = margin
          ensure(lh)
        }
        doc.text(mot, x, y)
        x += w
      }
    }
    y += lh + gapAfter
  }

  const blocs = parseContrat(opts.contenu)
  const dateLabel = opts.signedAt ? `Le ${formatDate(opts.signedAt)}` : null

  for (const b of blocs) {
    switch (b.type) {
      case 'titre':
        centre(b.texte, { size: 16, style: 'bold', gapAfter: 1 })
        break
      case 'soustitre':
        centre(b.texte, { size: 9.5, style: 'italic', gris: true, gapAfter: 0.5 })
        break
      case 'section':
        riche([{ text: b.texte, bold: true }], { size: 11.5, gapBefore: 3.5, gapAfter: 1.5 })
        break
      case 'definition':
        riche([{ text: `${b.terme} : `, bold: true }, { text: b.texte }], { gapAfter: 1.8 })
        break
      case 'paragraphe':
        riche([{ text: b.texte }])
        break
      case 'signature': {
        ensure(48)
        y += 6
        const colW = largeur / 2
        const xL = margin
        const xR = margin + colW + 4
        const yStart = y
        const col = (x: number, lignes: string[]) => {
          let yy = yStart
          lignes.forEach((ln, idx) => {
            doc.setFont(FONT, idx === 0 ? 'bold' : 'normal')
            doc.setFontSize(idx === 0 ? 10 : 9)
            doc.setTextColor(idx === 0 ? 25 : 90, idx === 0 ? 25 : 90, idx === 0 ? 25 : 90)
            doc.text(ln, x, yy)
            yy += idx === 0 ? 5 : 4.5
          })
          return yy
        }
        const yL = col(xL, b.gauche)
        const yR = col(xR, b.droite)
        const imgY = Math.max(yL, yR) + 1
        if (opts.apporteurSignatureUrl) {
          try {
            doc.addImage(opts.apporteurSignatureUrl, 'PNG', xL, imgY, 48, 19)
          } catch {
            /* image illisible */
          }
        }
        if (opts.signatureDataUrl) {
          try {
            doc.addImage(opts.signatureDataUrl, 'PNG', xR, imgY, 48, 19)
          } catch {
            /* image illisible */
          }
        }
        y = imgY + 21
        if (dateLabel) {
          doc.setFont(FONT, 'normal')
          doc.setFontSize(9)
          doc.setTextColor(90, 90, 90)
          doc.text(dateLabel, xL, y)
          doc.text(dateLabel, xR, y)
          y += 5
        }
        break
      }
    }
  }

  doc.save('contrat-celexia.pdf')
}
