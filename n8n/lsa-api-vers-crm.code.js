/**
 * n8n — Nœud Code : réponse API Local Services → leads CRM
 *
 * Workflow : Schedule → HTTP Request (API LSA) → CE NŒUD → HTTP Request (Supabase)
 *
 * L'email de notification LSA ne contient AUCUN numéro — seulement « un client
 * vous a appelé ». L'API `detailedLeadReports.search` est la seule source qui
 * expose `consumerPhoneNumber`, pour les appels comme pour les messages.
 *
 * Structure confirmée sur le document de découverte de l'API :
 *   leadId, leadType (PHONE_LEAD | MESSAGE_LEAD), leadCreationTimestamp,
 *   geo, leadCategory, leadPrice, chargeStatus,
 *   phoneLead   { consumerPhoneNumber, chargedCallTimestamp, … }
 *   messageLead { consumerPhoneNumber, customerName, postalCode, jobType }
 *
 * Le dédoublonnage est fait côté base (`ingerer_lead_externe`, idempotent sur
 * `source_ref`). Interroger toutes les 5 minutes rejoue forcément les mêmes
 * leads : c'est prévu, rien ne se duplique.
 */

// Correspondance des catégories LSA vers le référentiel métier du CRM.
// Une catégorie inconnue tombe sur « Rénovation » plutôt que d'inventer un
// métier qui ne correspondrait à aucun artisan.
const METIERS = {
  roofer: 'Toiture',
  roofing: 'Toiture',
  couvreur: 'Toiture',
  siding: 'Façade / Ravalement',
  facade: 'Façade / Ravalement',
  painter: 'Peinture',
  peintre: 'Peinture',
  flooring: 'Carrelage',
  carreleur: 'Carrelage',
  window: 'Menuiserie',
  menuisier: 'Menuiserie',
  fencing: 'Clôture',
  landscaper: 'Paysagisme',
  paysagiste: 'Paysagisme',
  plumber: 'Plomberie',
  plombier: 'Plomberie',
  electrician: 'Électricité',
  electricien: 'Électricité',
  mason: 'Maçonnerie',
  macon: 'Maçonnerie',
  insulation: 'Isolation',
  isolation: 'Isolation',
  deck: 'Terrasse',
  terrasse: 'Terrasse',
  pool: 'Piscine',
  piscine: 'Piscine',
}

function metierCrm(categorie) {
  if (!categorie) return null
  const c = String(categorie).toLowerCase().replace(/[_\-]/g, ' ')
  for (const [cle, valeur] of Object.entries(METIERS)) {
    if (c.includes(cle)) return valeur
  }
  return null
}

/** Format national à 10 chiffres. L'API renvoie souvent du +33. */
function telFr(brut) {
  if (!brut) return null
  let t = String(brut).replace(/\D/g, '')
  if (t.length === 11 && t.startsWith('33')) t = '0' + t.slice(2)
  else if (t.length === 12 && t.startsWith('033')) t = '0' + t.slice(3)
  else if (t.length === 9) t = '0' + t
  return t.length === 10 ? t : null
}

const sorties = []

for (const item of $input.all()) {
  // La réponse peut arriver enveloppée ou déjà éclatée selon la config du
  // nœud HTTP précédent.
  const rapports = item.json.detailedLeadReports ?? [item.json]

  for (const r of rapports) {
    if (!r || !r.leadId) continue

    const tel = telFr(r.phoneLead?.consumerPhoneNumber ?? r.messageLead?.consumerPhoneNumber)
    // Sans numéro, la fiche n'a aucune valeur — c'est précisément ce qui
    // rendait l'email inutilisable. On n'ingère pas un dossier vide.
    if (!tel) continue

    const estAppel = r.leadType === 'PHONE_LEAD'
    const nom = r.messageLead?.customerName || null
    const prix = r.leadPrice
      ? `${r.leadPrice} ${r.currencyCode ?? ''}`.trim()
      : null

    const lignes = [
      `Lead Google Local Services — ${estAppel ? 'appel téléphonique' : 'message'}.`,
      r.leadCategory ? `Catégorie LSA : ${r.leadCategory}` : null,
      r.messageLead?.jobType ? `Type de mission : ${r.messageLead.jobType}` : null,
      r.geo ? `Zone : ${r.geo}` : null,
      r.leadCreationTimestamp ? `Reçu le : ${r.leadCreationTimestamp}` : null,
      prix ? `Coût du lead : ${prix}` : null,
      r.chargeStatus ? `Facturation : ${r.chargeStatus}` : null,
      estAppel && r.phoneLead?.chargedConnectedCallDurationSeconds
        ? `Durée de l'appel : ${r.phoneLead.chargedConnectedCallDurationSeconds} s`
        : null,
      `\nÀ QUALIFIER : la nature exacte des travaux n'est pas transmise par LSA.`,
    ].filter(Boolean)

    sorties.push({
      json: {
        p_lead: {
          source: 'lsa',
          // `leadId` rend l'opération idempotente : c'est lui qui permet
          // d'interroger l'API en boucle sans créer de doublons.
          source_ref: String(r.leadId),
          telephone: tel,
          nom,
          code_postal: r.messageLead?.postalCode ?? null,
          ville: r.geo ?? null,
          metier: metierCrm(r.leadCategory ?? r.messageLead?.jobType),
          description: lignes.join('\n'),
        },
      },
    })
  }
}

return sorties
