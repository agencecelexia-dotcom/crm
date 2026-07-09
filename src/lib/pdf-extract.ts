import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Lecture best-effort du montant TTC d'un devis PDF (texte natif, pas d'OCR).
// Échoue toujours en silence : en cas d'échec le champ montant reste à saisir à la main.

const REGEX_MONTANT = /(\d{1,3}(?:[ .\u00A0]\d{3})*(?:,\d{2})?)\s*€/g

// Mots-clés (par ordre de priorité décroissante) indiquant qu'un montant est bien le total TTC.
const MOTS_CLES: { motif: RegExp; score: number }[] = [
  { motif: /net a payer/, score: 100 },
  { motif: /(?:montant )?total ttc/, score: 90 },
  { motif: /total a payer/, score: 85 },
  { motif: /montant ttc/, score: 80 },
  { motif: /total general/, score: 70 },
  { motif: /total/, score: 50 },
]

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function dernierIndex(texte: string, motif: RegExp): number {
  const occurrences = [...texte.matchAll(new RegExp(motif, 'g'))]
  return occurrences.length ? (occurrences[occurrences.length - 1].index ?? -1) : -1
}

// Retourne le score du meilleur mot-clé trouvé, ou -1 si "HT"/"hors taxe" est
// plus proche du montant que tout mot-clé TTC (on écarte alors ce candidat).
function scoreFenetre(fenetre: string): number {
  const norm = normaliser(fenetre)
  const indexHT = Math.max(
    dernierIndex(norm, /hors taxe/),
    dernierIndex(norm, /hors-taxe/),
    dernierIndex(norm, / ht\b/),
  )
  for (const { motif, score } of MOTS_CLES) {
    const index = dernierIndex(norm, motif)
    if (index === -1) continue
    if (indexHT !== -1 && indexHT > index) return -1
    return score
  }
  return 0
}

// Parse un montant au format FR ("1 234,56", "1.234,56", "250", "45,00") en nombre.
function parseMontantFr(brut: string): number | null {
  const s = brut.trim()
  if (!s) return null
  let valeur: number
  const virgule = s.lastIndexOf(',')
  if (virgule !== -1) {
    const entier = s.slice(0, virgule).replace(/[ .\u00A0]/g, '')
    valeur = parseFloat(`${entier}.${s.slice(virgule + 1)}`)
  } else if (/\.\d{2}$/.test(s)) {
    const point = s.lastIndexOf('.')
    const entier = s.slice(0, point).replace(/[ .\u00A0]/g, '')
    valeur = parseFloat(`${entier}.${s.slice(point + 1)}`)
  } else {
    valeur = parseFloat(s.replace(/[ .\u00A0]/g, ''))
  }
  if (!Number.isFinite(valeur) || valeur < 1 || valeur > 1_000_000) return null
  return valeur
}

// Choisit le meilleur montant total TTC dans un texte de devis.
function extraireMeilleurMontant(texte: string): number | null {
  const candidats: { valeur: number; score: number; index: number }[] = []
  for (const match of texte.matchAll(REGEX_MONTANT)) {
    const valeur = parseMontantFr(match[1])
    if (valeur == null || match.index == null) continue
    const fenetre = texte.slice(Math.max(0, match.index - 45), match.index)
    const score = scoreFenetre(fenetre)
    if (score < 0) continue
    candidats.push({ valeur, score, index: match.index })
  }
  if (candidats.length === 0) return null

  const avecMotCle = candidats.filter((c) => c.score > 0)
  if (avecMotCle.length > 0) {
    const meilleurScore = Math.max(...avecMotCle.map((c) => c.score))
    const meilleurs = avecMotCle.filter((c) => c.score === meilleurScore)
    return meilleurs[meilleurs.length - 1].valeur // dernière occurrence = le plus souvent le vrai total
  }
  // Repli : aucun mot-clé trouvé → le plus gros montant du document.
  return candidats.reduce((max, c) => (c.valeur > max.valeur ? c : max)).valeur
}

// Tente de lire le montant TTC d'un PDF de devis. Retourne `null` en cas d'échec
// (PDF scanné/image, corrompu, aucun montant détecté...) — jamais d'exception.
export async function extraireMontantDevis(file: File): Promise<number | null> {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

    const data = await file.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data }).promise
    let texte = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const contenu = await page.getTextContent()
      texte += contenu.items.map((item) => ('str' in item ? item.str : '')).join(' ') + ' '
    }
    texte = texte.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ')
    return extraireMeilleurMontant(texte)
  } catch {
    return null
  }
}
