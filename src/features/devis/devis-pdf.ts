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
    /** Logo propre à l'entreprise. Aucun logo par défaut : mieux vaut pas de
     *  logo que celui d'une autre entreprise. */
    logoUrl?: string | null
    capital?: string | null
    villeImmat?: string | null
    tvaIntracom?: string | null
    ape?: string | null
    iban?: string | null
    bic?: string | null
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
  /** Le taux par ligne permet la ventilation de la TVA, obligatoire dès que
   *  le devis en mêle plusieurs. */
  lignes: (DevisLigne & { tva_taux?: number | null })[]
  total: number // TTC — ce que paie le client
  totalHt?: number | null
  totalTva?: number | null
  /** 'franchise' = art. 293 B du CGI (auto-entrepreneur), sinon TVA applicable. */
  tvaMode?: string | null
  acomptePct?: number | null
  conditions?: string | null
  /** Mentions obligatoires — l'assurance vient de la fiche artisan (0131). */
  assurance?: {
    assureur?: string | null
    police?: string | null
    /** Couverture géographique : première chose que vérifie un assureur. */
    zone?: string | null
    rcProAssureur?: string | null
    rcProPolice?: string | null
  } | null
  mediateur?: { nom?: string | null; url?: string | null } | null
  /** Conditions générales, imprimées en dernière page (0139). */
  cgv?: string | null
  conditionsPaiement?: string | null
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

// Même précaution que pour les montants : l'espace fine insécable (U+202F)
// qu'Intl insère entre les milliers n'existe pas dans la police Helvetica de
// jsPDF et s'y imprime en barre — « 1 / 0 0 0 / 0 0 0 » pour un million.
const qte = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, ' ')

function chargerImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Construit le document jsPDF du devis (en-tête, tableau, totaux, CGV). */
export async function construireDevis(data: DevisData) {
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
  //
  // Aucun logo par défaut : imprimer celui d'une autre entreprise sur le devis
  // d'un artisan serait pire que n'en imprimer aucun.
  const logo = data.vendeur.logoUrl ? await chargerImage(data.vendeur.logoUrl) : null
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
  // L'adresse saisie contient souvent déjà le code postal et la ville ; les
  // réafficher dessous donnait « 862 Rte de la Dranse, 74500 Publier » suivi de
  // « 74500 Publier ».
  const cpVille = [v.cp, v.ville].filter(Boolean).join(' ')
  const infos = [
    v.adresse,
    cpVille && !(v.adresse ?? '').includes(cpVille) ? cpVille : null,
    [v.forme, v.capital ? `capital ${v.capital}` : null].filter(Boolean).join(' — ') || null,
    v.siren ? `SIREN ${v.siren}${v.villeImmat ? ` — RCS ${v.villeImmat}` : ''}` : null,
    v.tvaIntracom ? `TVA ${v.tvaIntracom}` : null,
    v.ape ? `APE ${v.ape}` : null,
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
    doc.text(
      l.quantite != null ? qte(Number(l.quantite)) : '',
      xOf(1) + cols[1].w - 2,
      midY,
      { align: 'right' },
    )
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

  // ---------- Totaux ----------
  //
  // Deux présentations : l'artisan en franchise porte la mention du CGI et un
  // seul total ; celui qui facture la TVA doit faire apparaître HT et TVA
  // séparément, faute de quoi le devis n'est pas opposable.
  ensure(42)
  const boxW = 80
  const bx = pageW - margin - boxW
  const franchise = (data.tvaMode ?? 'franchise') === 'franchise'
  doc.setFont(F, 'normal')
  doc.setFontSize(9)

  if (franchise) {
    setColor(GRIS_CLAIR)
    doc.text('TVA non applicable, art. 293 B du CGI', bx, y)
    y += 7
  } else {
    setColor(GRIS)
    doc.setFontSize(9.5)
    doc.text('Total HT', bx + 3, y)
    doc.text(eur(data.totalHt ?? data.total), pageW - margin - 3, y, { align: 'right' })
    y += 5.5

    // Un devis mêlant 10 % et 20 % doit faire apparaître la base et la taxe de
    // CHAQUE taux : un total agrégé ne permet ni au client de vérifier, ni à
    // l'administration de contrôler.
    const parTaux = new Map<number, number>()
    for (const l of data.lignes) {
      const taux = Number(l.tva_taux) || 0
      const ht = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0)
      parTaux.set(taux, (parTaux.get(taux) ?? 0) + ht)
    }
    const taux = [...parTaux.entries()].filter(([t]) => t > 0).sort((a, b) => a[0] - b[0])

    if (taux.length > 1) {
      for (const [t, ht] of taux) {
        doc.text(`TVA ${t.toLocaleString('fr-FR')} % sur ${eur(ht)}`, bx + 3, y)
        doc.text(eur((ht * t) / 100), pageW - margin - 3, y, { align: 'right' })
        y += 5
      }
      y += 1.5
    } else {
      doc.text(taux.length === 1 ? `TVA ${taux[0][0].toLocaleString('fr-FR')} %` : 'TVA', bx + 3, y)
      doc.text(eur(data.totalTva ?? 0), pageW - margin - 3, y, { align: 'right' })
      y += 6.5
    }
  }
  doc.setFillColor(245, 243, 255)
  doc.rect(bx, y, boxW, 11, 'F')
  doc.setFont(F, 'bold')
  doc.setFontSize(12)
  setColor(NAVY)
  doc.text(franchise ? 'NET À PAYER' : 'TOTAL TTC', bx + 3, y + 7)
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

  // ---------- Mentions obligatoires ----------
  //
  // Un devis qui ne les porte pas est attaquable. Elles sont ajoutées d'office
  // plutôt que laissées à la mémoire de l'artisan.
  const mentions: string[] = []
  const a = data.assurance
  if (a?.assureur) {
    mentions.push(
      `Assurance décennale : ${a.assureur}`
        + (a.police ? ` — police n° ${a.police}` : '')
        + (a.zone ? ` — couverture : ${a.zone}` : ''),
    )
  }
  if (a?.rcProAssureur) {
    mentions.push(
      `Responsabilité civile professionnelle : ${a.rcProAssureur}`
        + (a.rcProPolice ? ` — police n° ${a.rcProPolice}` : ''),
    )
  }
  if (data.conditionsPaiement) mentions.push(data.conditionsPaiement)
  if (v.iban) {
    mentions.push(`Règlement par virement : IBAN ${v.iban}${v.bic ? ` — BIC ${v.bic}` : ''}.`)
  }
  mentions.push(
    // Face à un CONSOMMATEUR, les intérêts moratoires ne courent qu'à compter
    // de la mise en demeure (art. 1231-6 du code civil). L'exigibilité de plein
    // droit est la règle entre professionnels (art. L441-10 du code de
    // commerce) : l'écrire ici promettait à l'artisan un droit qu'il n'a pas.
    'Retard de paiement : intérêts au taux légal en vigueur, à compter de la mise en '
      + 'demeure adressée au client.',
    'Devis gratuit. Démarchage à domicile : le client dispose d’un délai de rétractation '
      + 'de 14 jours (art. L221-18 du Code de la consommation).',
    data.mediateur?.nom
      ? `Médiateur de la consommation : ${data.mediateur.nom}`
          + (data.mediateur.url ? ` — ${data.mediateur.url}` : '')
          + ' (art. L612-1 du Code de la consommation).'
      : 'En cas de litige, le client peut recourir gratuitement à un médiateur de la '
          + 'consommation (art. L612-1 du Code de la consommation).',
  )

  ensure(6 + mentions.length * 4)
  doc.setFont(F, 'normal')
  doc.setFontSize(7.5)
  setColor(GRIS_CLAIR)
  for (const m of mentions) {
    for (const ligne of doc.splitTextToSize(m, largeur)) {
      doc.text(ligne, margin, y)
      y += 3.4
    }
  }
  y += 3

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

  // ---------- Conditions générales ----------
  //
  // Sur une page à part : elles ne doivent ni repousser le « bon pour accord »
  // en deuxième page, ni se retrouver coupées au milieu d'un article.
  if (data.cgv?.trim()) {
    doc.addPage()
    y = margin
    doc.setFont(F, 'bold')
    doc.setFontSize(12)
    setColor(NAVY)
    doc.text('Conditions générales', margin, y)
    y += 7
    doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2])
    doc.setLineWidth(0.5)
    doc.line(margin, y - 3, margin + 40, y - 3)

    doc.setFontSize(7.5)
    for (const paragraphe of data.cgv.trim().split(/\n\s*\n/)) {
      const [titre, ...reste] = paragraphe.split('\n')
      // Un titre d'article est court et commence par son numéro : le mettre en
      // gras rend les onze articles parcourables d'un coup d'œil.
      const estTitre = /^\d+\.\s/.test(titre) && titre.length < 70
      ensure(8)
      doc.setFont(F, estTitre ? 'bold' : 'normal')
      setColor(estTitre ? NAVY : GRIS)
      for (const ln of doc.splitTextToSize(titre, largeur)) {
        ensure(3.6)
        doc.text(ln, margin, y)
        y += 3.6
      }
      if (reste.length) {
        doc.setFont(F, 'normal')
        setColor(GRIS)
        for (const ln of doc.splitTextToSize(reste.join(' '), largeur)) {
          ensure(3.6)
          doc.text(ln, margin, y)
          y += 3.6
        }
      }
      y += 2.5
    }
  }

  // ---------- Bon pour accord ----------
  //
  // APRÈS les conditions générales, jamais avant. Le client signe une fois
  // qu'il les a sous les yeux ; l'audit a relevé qu'il signait en page 2 des
  // conditions qui commençaient en page 3.
  ensure(34)
  y += 4
  doc.setFont(F, 'normal')
  doc.setFontSize(9.5)
  setColor(GRIS)
  doc.text(
    'Lu et approuvé, bon pour accord (date et signature du client) :',
    pageW - margin - 92,
    y,
  )
  doc.setDrawColor(BORD[0], BORD[1], BORD[2])
  doc.roundedRect(pageW - margin - 92, y + 3, 92, 24, 1.5, 1.5)

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
    // Une page détachée d'un devis de trois pages doit pouvoir s'y raccrocher.
    if (total > 1) doc.text(`${p} / ${total}`, pageW - margin, pageH - 8, { align: 'right' })
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
