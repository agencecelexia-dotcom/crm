import { formatDate } from '@/lib/format'

// Génère et télécharge le contrat signé au format PDF (texte + signature).
// jsPDF est importé dynamiquement pour ne pas alourdir le bundle initial.
export async function telechargerContratPdf(opts: {
  contenu: string
  signataire: string | null
  signedAt: string | null
  signatureDataUrl: string | null
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

  // Bloc signature
  if (y > hauteur - 60) {
    doc.addPage()
    y = margin
  }
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.text('Signature de l’Artisan', margin, y)
  doc.setFont('helvetica', 'normal')
  y += 6
  if (opts.signataire) {
    doc.text(`Signataire : ${opts.signataire}`, margin, y)
    y += 6
  }
  if (opts.signedAt) {
    doc.text(`Signé le : ${formatDate(opts.signedAt)}`, margin, y)
    y += 4
  }
  if (opts.signatureDataUrl) {
    try {
      doc.addImage(opts.signatureDataUrl, 'PNG', margin, y, 60, 25)
    } catch {
      // image illisible : on ignore
    }
  }

  doc.save('contrat-celexia-signe.pdf')
}
