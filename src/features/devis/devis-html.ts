import type { DevisData } from './devis-pdf'

/**
 * Le devis en HTML, pour le courriel envoyé au client.
 *
 * Le PDF reste la pièce contractuelle ; cet HTML est ce que le client voit
 * EN PREMIER, souvent sur un téléphone, souvent sans ouvrir la pièce jointe.
 * C'est donc lui qui décide si le devis est lu ou archivé.
 *
 * ÉCRIT POUR DES CLIENTS DE MESSAGERIE, PAS POUR UN NAVIGATEUR
 *
 * Outlook rend le HTML avec le moteur de Word : ni flexbox, ni grid, ni
 * position, ni `rem`. Tout passe donc par des tableaux imbriqués, des styles
 * en ligne et des pixels. Les feuilles de style externes sont ignorées ou
 * supprimées par les messageries, d'où l'absence de `<style>`.
 *
 * L'identité affichée est celle de L'ARTISAN, jamais la nôtre : le client
 * n'a pas de relation avec Celexia, il traite avec son entreprise.
 */

const ENCRE = '#1F3A5F'
const ACCENT = '#EA580C'
const GRIS = '#4A5568'
const GRIS_CLAIR = '#8A94A6'
const BORD = '#E2E6ED'
const FOND = '#F4F6F9'

const POLICE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, '&nbsp;') + '&nbsp;€'

const qte = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n || 0)

const jour = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** Rien de ce qui vient de l'artisan ou du client ne doit pouvoir injecter du HTML. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Passe à la ligne comme dans le champ d'origine. */
const multi = (v?: string | null) => esc(v).replace(/\n/g, '<br>')

export function devisEnHtml(data: DevisData): string {
  const v = data.vendeur
  const franchise = (data.tvaMode ?? 'franchise') === 'franchise'
  const lignes = data.lignes ?? []
  const acompte =
    data.acomptePct && data.acomptePct > 0 ? (data.total * data.acomptePct) / 100 : null

  // La TVA par taux : le client doit pouvoir rapprocher chaque base de sa taxe.
  const parTaux = new Map<number, number>()
  for (const l of lignes) {
    const t = Number((l as { tva_taux?: number | null }).tva_taux) || 0
    parTaux.set(t, (parTaux.get(t) ?? 0) + (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0))
  }
  const taux = [...parTaux.entries()].filter(([t]) => t > 0).sort((a, b) => a[0] - b[0])

  const coordonnees = [
    v.adresse,
    [v.cp, v.ville].filter(Boolean).join(' '),
    v.tel,
    v.email,
  ]
    .filter(Boolean)
    .map((x) => esc(x))
    .join('&nbsp;&nbsp;·&nbsp;&nbsp;')

  const immat = [
    v.forme,
    v.siren ? `SIREN ${v.siren}` : null,
    v.villeImmat ? `RCS ${v.villeImmat}` : null,
    v.tvaIntracom ? `TVA ${v.tvaIntracom}` : null,
  ]
    .filter(Boolean)
    .map((x) => esc(x))
    .join('&nbsp;·&nbsp;')

  const ligneTotal = (label: string, montant: string, fort = false) => `
    <tr>
      <td style="padding:${fort ? '10px' : '4px'} 0 ${fort ? '10px' : '4px'} 0;font:${
        fort ? '600 16px' : '400 14px'
      }/1.4 ${POLICE};color:${fort ? ENCRE : GRIS};">${label}</td>
      <td align="right" style="padding:${fort ? '10px' : '4px'} 0;font:${
        fort ? '700 18px' : '400 14px'
      }/1.4 ${POLICE};color:${fort ? ENCRE : GRIS};white-space:nowrap;">${montant}</td>
    </tr>`

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Devis ${esc(data.numero)}</title></head>
<body style="margin:0;padding:0;background:${FOND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Devis ${esc(data.numero)} — ${eur(data.total)}${data.objet ? ' — ' + esc(data.objet) : ''}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FOND};">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(31,58,95,.08);">

  <!-- En-tête : l'entreprise de l'artisan -->
  <tr><td style="padding:28px 32px 22px 32px;border-bottom:3px solid ${ACCENT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${
        v.logoUrl
          ? `<td valign="middle" style="width:120px;padding-right:16px;">
               <img src="${esc(v.logoUrl)}" alt="${esc(v.nom)}" width="110"
                    style="display:block;width:110px;max-width:110px;height:auto;border:0;">
             </td>`
          : ''
      }
      <td valign="middle">
        <div style="font:700 20px/1.25 ${POLICE};color:${ENCRE};">${esc(v.nom)}</div>
        ${
          coordonnees
            ? `<div style="margin-top:6px;font:400 12px/1.6 ${POLICE};color:${GRIS_CLAIR};">${coordonnees}</div>`
            : ''
        }
      </td>
    </tr></table>
  </td></tr>

  <!-- Le devis : numéro, date, validité -->
  <tr><td style="padding:26px 32px 0 32px;">
    <div style="font:700 26px/1.2 ${POLICE};color:${ENCRE};letter-spacing:-.3px;">
      Devis n°&nbsp;${esc(data.numero)}
    </div>
    ${
      data.objet
        ? `<div style="margin-top:6px;font:400 15px/1.5 ${POLICE};color:${GRIS};">${esc(data.objet)}</div>`
        : ''
    }
    <div style="margin-top:10px;font:400 13px/1.6 ${POLICE};color:${GRIS_CLAIR};">
      Établi le ${esc(jour(data.date))}${
        data.dateValidite ? ` · valable jusqu’au <span style="color:${GRIS};">${esc(jour(data.dateValidite))}</span>` : ''
      }
    </div>
  </td></tr>

  <!-- Le client -->
  ${
    data.client?.nom
      ? `<tr><td style="padding:22px 32px 0 32px;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                  style="background:${FOND};border-radius:10px;">
             <tr><td style="padding:14px 16px;">
               <div style="font:600 11px/1 ${POLICE};color:${GRIS_CLAIR};letter-spacing:.7px;text-transform:uppercase;">Client</div>
               <div style="margin-top:6px;font:600 15px/1.4 ${POLICE};color:${ENCRE};">${esc(data.client.nom)}</div>
               ${
                 [data.client.adresse, [data.client.cp, data.client.ville].filter(Boolean).join(' ')]
                   .filter(Boolean).length
                   ? `<div style="margin-top:3px;font:400 13px/1.5 ${POLICE};color:${GRIS};">${[
                       data.client.adresse,
                       [data.client.cp, data.client.ville].filter(Boolean).join(' '),
                     ]
                       .filter(Boolean)
                       .map((x) => esc(x))
                       .join('<br>')}</div>`
                   : ''
               }
             </td></tr>
           </table>
         </td></tr>`
      : ''
  }

  <!-- Le détail -->
  <tr><td style="padding:26px 32px 0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <th align="left" style="padding:0 0 8px 0;border-bottom:2px solid ${ENCRE};font:600 11px/1 ${POLICE};color:${ENCRE};letter-spacing:.7px;text-transform:uppercase;">Prestation</th>
        <th align="right" style="padding:0 0 8px 10px;border-bottom:2px solid ${ENCRE};font:600 11px/1 ${POLICE};color:${ENCRE};letter-spacing:.7px;text-transform:uppercase;white-space:nowrap;">Qté</th>
        <th align="right" style="padding:0 0 8px 10px;border-bottom:2px solid ${ENCRE};font:600 11px/1 ${POLICE};color:${ENCRE};letter-spacing:.7px;text-transform:uppercase;white-space:nowrap;">P.U.</th>
        <th align="right" style="padding:0 0 8px 10px;border-bottom:2px solid ${ENCRE};font:600 11px/1 ${POLICE};color:${ENCRE};letter-spacing:.7px;text-transform:uppercase;white-space:nowrap;">Total</th>
      </tr>
      ${lignes
        .map((l) => {
          const t = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0)
          return `<tr>
            <td style="padding:12px 0;border-bottom:1px solid ${BORD};font:400 14px/1.5 ${POLICE};color:${ENCRE};">${esc(
              l.designation,
            )}</td>
            <td align="right" style="padding:12px 0 12px 10px;border-bottom:1px solid ${BORD};font:400 13px/1.5 ${POLICE};color:${GRIS};white-space:nowrap;">${qte(
              Number(l.quantite) || 0,
            )} ${esc(l.unite ?? '')}</td>
            <td align="right" style="padding:12px 0 12px 10px;border-bottom:1px solid ${BORD};font:400 13px/1.5 ${POLICE};color:${GRIS};white-space:nowrap;">${eur(
              Number(l.prix_unitaire) || 0,
            )}</td>
            <td align="right" style="padding:12px 0 12px 10px;border-bottom:1px solid ${BORD};font:600 14px/1.5 ${POLICE};color:${ENCRE};white-space:nowrap;">${eur(
              t,
            )}</td>
          </tr>`
        })
        .join('')}
    </table>
  </td></tr>

  <!-- Totaux -->
  <tr><td style="padding:18px 32px 0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td></td>
      <td width="280" style="width:280px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${
            franchise
              ? ''
              : ligneTotal('Total HT', eur(data.totalHt ?? data.total)) +
                (taux.length
                  ? taux
                      .map(([t, ht]) =>
                        ligneTotal(
                          `TVA ${t.toLocaleString('fr-FR')}&nbsp;% sur ${eur(ht)}`,
                          eur((ht * t) / 100),
                        ),
                      )
                      .join('')
                  : ligneTotal('TVA', eur(data.totalTva ?? 0)))
          }
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin-top:8px;background:${ENCRE};border-radius:10px;">
          <tr>
            <td style="padding:14px 16px;font:600 13px/1.3 ${POLICE};color:#C8D4E6;letter-spacing:.4px;text-transform:uppercase;">${
              franchise ? 'Net à payer' : 'Total TTC'
            }</td>
            <td align="right" style="padding:14px 16px;font:700 22px/1.2 ${POLICE};color:#FFFFFF;white-space:nowrap;">${eur(
              data.total,
            )}</td>
          </tr>
        </table>
        ${
          franchise
            ? `<div style="margin-top:8px;text-align:right;font:400 11px/1.5 ${POLICE};color:${GRIS_CLAIR};">TVA non applicable, art.&nbsp;293&nbsp;B du CGI</div>`
            : ''
        }
      </td>
    </tr></table>
  </td></tr>

  ${
    acompte
      ? `<tr><td style="padding:18px 32px 0 32px;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                  style="background:#FFF7ED;border-left:3px solid ${ACCENT};border-radius:0 8px 8px 0;">
             <tr><td style="padding:12px 16px;font:400 13px/1.6 ${POLICE};color:#9A3412;">
               Acompte à la commande (${esc(data.acomptePct)}&nbsp;%) :
               <strong>${eur(acompte)}</strong> — solde de <strong>${eur(data.total - acompte)}</strong> à la fin des travaux.
             </td></tr>
           </table>
         </td></tr>`
      : ''
  }

  ${
    data.conditions
      ? `<tr><td style="padding:20px 32px 0 32px;">
           <div style="font:600 11px/1 ${POLICE};color:${GRIS_CLAIR};letter-spacing:.7px;text-transform:uppercase;">Conditions</div>
           <div style="margin-top:7px;font:400 13px/1.6 ${POLICE};color:${GRIS};">${multi(data.conditions)}</div>
         </td></tr>`
      : ''
  }

  <!-- La pièce contractuelle reste le PDF -->
  <tr><td style="padding:22px 32px 0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:${FOND};border-radius:10px;">
      <tr><td style="padding:14px 16px;font:400 13px/1.6 ${POLICE};color:${GRIS};">
        Le devis complet, avec les mentions légales et les conditions générales, est joint à ce
        message au format PDF. C’est cet exemplaire qui fait foi&nbsp;: pour l’accepter, il vous
        suffit de le retourner signé, avec la mention «&nbsp;bon pour accord&nbsp;».
      </td></tr>
    </table>
  </td></tr>

  <!-- Mentions -->
  <tr><td style="padding:22px 32px 26px 32px;">
    ${
      data.assurance?.assureur
        ? `<div style="font:400 11px/1.6 ${POLICE};color:${GRIS_CLAIR};">Assurance décennale : ${esc(
            data.assurance.assureur,
          )}${data.assurance.police ? ` — police n°&nbsp;${esc(data.assurance.police)}` : ''}${
            data.assurance.zone ? ` — couverture : ${esc(data.assurance.zone)}` : ''
          }</div>`
        : ''
    }
    <div style="margin-top:4px;font:400 11px/1.6 ${POLICE};color:${GRIS_CLAIR};">
      Devis gratuit. Pour un contrat conclu hors établissement, vous disposez d’un délai de
      rétractation de quatorze jours (art.&nbsp;L221-18 du code de la consommation).
    </div>
    ${
      immat
        ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid ${BORD};font:400 11px/1.6 ${POLICE};color:${GRIS_CLAIR};">${immat}</div>`
        : ''
    }
  </td></tr>

</table>

<div style="margin-top:14px;font:400 11px/1.6 ${POLICE};color:${GRIS_CLAIR};max-width:600px;">
  Ce message vous est adressé par ${esc(v.nom)} à la suite de votre demande de travaux.
</div>

</td></tr></table>
</body></html>`
}

/** Objet du courriel : ce que le client voit dans sa liste, avant d'ouvrir. */
export function objetCourriel(data: DevisData): string {
  const montant = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(data.total || 0)
    .replace(/[\u202f\u00a0]/g, ' ')
  return `Votre devis ${data.numero} — ${data.objet || 'travaux'} — ${montant} €`
}
