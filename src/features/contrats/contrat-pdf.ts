import { formatDate } from '@/lib/format'

// Génère et télécharge le contrat signé au format PDF (texte + signature).
// jsPDF est importé dynamiquement pour ne pas alourdir le bundle initial.
export async function telechargerContratPdf(opts: {
  contenu: string
  signataire: string | null
  signedAt: string | null
  signatureDataUrl: string | null
  apporteurSignatureUrl?: string | null
}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const margin = 18
  const largeur = doc.internal.pageSize.getWidth() - margin * 2
  const hauteur = doc.internal.pageSize.getHeight()
  let y = margin

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)

  // Découpe le texte du contrat sur plusieurs lignes / pages
  const lignes = doc.splitTextToSize(opts.contenu, largeur) as string[]
  for (const ligne of lignes) {
    if (y > hauteur - margin) {
      doc.addPage()
      y = margin
    }
    doc.text(ligne, margin, y)
    y += 6
  }

  // Bloc signatures — 2 colonnes : Apporteur (CELEXIA, pré-signé) | Artisan
  if (y > hauteur - 70) {
    doc.addPage()
    y = margin
  }
  y += 10
  const col2 = margin + largeur / 2 + 4
  const dateLabel = opts.signedAt ? `Le ${formatDate(opts.signedAt)}` : ''

  doc.setFont('helvetica', 'bold')
  doc.text('Pour l’Apporteur (CELEXIA)', margin, y)
  doc.text('Pour le Partenaire', col2, y)
  doc.setFont('helvetica', 'normal')
  y += 6
  doc.text('M. Thomas Aubigeon, Président', margin, y)
  if (opts.signataire) doc.text(opts.signataire, col2, y)
  y += 5
  if (dateLabel) {
    doc.text(dateLabel, margin, y)
    doc.text(dateLabel, col2, y)
  }
  y += 4
  // Images des signatures
  if (opts.apporteurSignatureUrl) {
    try {
      doc.addImage(opts.apporteurSignatureUrl, 'PNG', margin, y, 55, 22)
    } catch {
      // image illisible : on ignore
    }
  }
  if (opts.signatureDataUrl) {
    try {
      doc.addImage(opts.signatureDataUrl, 'PNG', col2, y, 55, 22)
    } catch {
      // image illisible : on ignore
    }
  }

  doc.save('contrat-celexia-signe.pdf')
}
