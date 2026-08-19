/**
 * n8n — Nœud Code : email de notification LSA → lead CRM
 *
 * Workflow : Gmail Trigger → CE NŒUD → HTTP Request (Supabase)
 *
 * Google Local Services Ads n'émet aucun webhook : la seule notification
 * temps réel est l'email envoyé à chaque nouveau lead. On l'analyse ici.
 *
 * Le format de ces emails change sans préavis — Google les remanie
 * régulièrement. Ce code extrait donc par MOTIFS (un numéro de téléphone
 * français, un code postal à 5 chiffres) plutôt qu'en s'appuyant sur une
 * structure HTML figée, qui casserait à la première refonte.
 *
 * Sortie : un objet prêt pour `ingerer_lead_externe`. Le dédoublonnage est
 * fait côté base, pas ici : n8n peut rejouer un email sans conséquence.
 */

const items = $input.all()
const sorties = []

for (const item of items) {
  const mail = item.json
  // Gmail Trigger expose le corps sous plusieurs noms selon la version.
  const brut = [mail.textPlain, mail.textHtml, mail.snippet, mail.text, mail.body]
    .filter(Boolean)
    .join('\n')

  // HTML → texte : les entités et les balises brouillent les motifs.
  const texte = brut
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Le séparateur est OBLIGATOIRE : sans lui, « client » dans une phrase
  // courante (« un client vous a contacté au… ») capturait toute la phrase
  // comme nom. Une étiquette de formulaire est toujours suivie de « : ».
  const apres = (etiquettes) => {
    for (const e of etiquettes) {
      const m = texte.match(new RegExp(`${e}\\s*[:\\-–]\\s*([^\\n]{2,60})`, 'i'))
      if (!m) continue
      const v = m[1].trim().replace(/[.,;]$/, '')
      // Une valeur qui contient un numéro ou fait une phrase entière n'est
      // pas une valeur de champ.
      if (/\d{6,}/.test(v.replace(/\D/g, '')) || v.split(/\s+/).length > 6) continue
      return v
    }
    return null
  }

  // Un mobile français, quel que soit son formatage dans l'email.
  const telBrut =
    texte.match(/(?:\+33|0033|0)\s?[1-9](?:[\s.\-]?\d{2}){4}/)?.[0] ?? null
  let telephone = telBrut ? telBrut.replace(/\D/g, '') : null
  if (telephone?.startsWith('33') && telephone.length === 11) telephone = '0' + telephone.slice(2)
  if (telephone?.startsWith('0033')) telephone = '0' + telephone.slice(4)

  const cp = texte.match(/\b(\d{5})\b/)?.[1] ?? null

  // L'identifiant du lead rend l'opération idempotente. À défaut, on
  // retombe sur l'identifiant du message Gmail, unique lui aussi.
  const source_ref =
    texte.match(/(?:lead\s*id|id\s*du\s*lead|reference)\s*[:#]?\s*([A-Za-z0-9\-_]{4,})/i)?.[1] ??
    mail.id ??
    mail.messageId ??
    null

  const nom = apres(['nom du client', 'customer name', 'client', 'nom', 'name'])
  const ville = apres(['ville', 'city', 'localité', 'commune'])
  const metier = apres(['service', 'catégorie', 'category', 'type de service', 'job type'])
  const email = texte.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ?? null

  sorties.push({
    json: {
      p_lead: {
        source: 'lsa',
        source_ref,
        telephone,
        // Sans nom, la base retombe sur le téléphone : une fiche reste
        // identifiable, ce qui vaut mieux qu'un dossier anonyme.
        nom,
        email,
        ville,
        code_postal: cp,
        metier,
        // Le corps du mail est conservé en entier : l'analyse peut manquer
        // un détail que l'humain retrouvera en lisant la fiche.
        description:
          `Lead Google Local Services${source_ref ? ` (réf. ${source_ref})` : ''}.\n\n` +
          `--- Message reçu ---\n${texte.slice(0, 1500)}`,
      },
    },
  })
}

return sorties
