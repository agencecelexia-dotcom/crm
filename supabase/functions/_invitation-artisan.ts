export type InvitationArtisan = { email: string; prenom: string; nom: string; societe: string; taux: 10 | 15 | 20 }

export function validerInvitation(input: unknown): InvitationArtisan {
  if (!input || typeof input !== 'object') throw new Error('Informations manquantes')
  const p = input as Record<string, unknown>
  const texte = (cle: string, max: number) => {
    if (p[cle] == null) return ''
    if (typeof p[cle] !== 'string' || p[cle].length > max || Array.from(p[cle]).some((c) => c.charCodeAt(0) < 32)) throw new Error(`Champ ${cle} invalide`)
    return p[cle].trim()
  }
  const email = texte('email', 254).toLowerCase()
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw new Error('Renseignez une adresse email valide')
  if (p.taux !== 10 && p.taux !== 15 && p.taux !== 20) throw new Error('Choisissez un taux de 10, 15 ou 20 %')
  return { email, prenom: texte('prenom', 100), nom: texte('nom', 100), societe: texte('societe', 160), taux: p.taux }
}

const h = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Pas de donnée personnelle dans l'URL ; source et taux toujours explicites. */
export function lienInscription(origin: string, canal: string, taux: number) {
  return `${origin.replace(/\/$/, '')}/rejoindre${canal ? '/' + encodeURIComponent(canal) : ''}?taux=${taux}`
}

export function emailInvitation(p: InvitationArtisan, origin = 'https://crm-ci7k.vercel.app') {
  const lien = lienInscription(origin, 'email', p.taux)
  const destinataire = [p.prenom, p.nom].filter(Boolean).join(' ')
  const bonjour = destinataire ? `Bonjour ${destinataire},` : p.societe ? `Bonjour à l’équipe ${p.societe},` : 'Bonjour,'
  const subject = 'Votre invitation à rejoindre Celexia'
  const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f4f2f8;color:#20202b;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">Votre accès au réseau Celexia et votre inscription à ${p.taux} %.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f8"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e1ef">
<tr><td style="height:6px;background:#7c3aed"></td></tr>
<tr><td style="padding:30px 32px 22px"><img src="${h(origin)}/logo.png" width="190" height="31" alt="Celexia" style="display:block;border:0;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:0 32px 30px">
<p style="margin:0 0 14px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#6d28d9">VOTRE INVITATION</p>
<h1 style="margin:0 0 24px;font-size:30px;line-height:1.2;font-weight:700">Faisons avancer<br>vos prochains chantiers.</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.65">${h(bonjour)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#4b455b">Celexia vous invite à rejoindre son réseau d’entreprises du bâtiment. Présentez votre activité, vos métiers et votre zone d’intervention pour que nous puissions vous proposer des projets adaptés.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px"><tr><td style="padding:20px">
<p style="margin:0 0 6px;font-size:12px;font-weight:bold;color:#5b21b6">VOTRE TAUX DE COMMISSION</p>
<p style="margin:0;font-size:28px;font-weight:bold;color:#5b21b6">${p.taux} % <span style="font-size:14px;font-weight:normal">du montant TTC des devis signés</span></p>
<p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#51416b">Ce taux est repris dans le contrat présenté lors de votre inscription. Prenez le temps de le consulter avant de signer.</p>
</td></tr></table>
<p style="margin:24px 0 18px;font-size:14px;line-height:1.8;color:#4b455b"><b>1.</b> Renseignez votre entreprise<br><b>2.</b> Consultez et signez votre contrat<br><b>3.</b> Retrouvez votre espace artisan</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#7c3aed" style="border-radius:8px"><a href="${h(lien)}" style="display:inline-block;padding:16px 24px;border:1px solid #7c3aed;border-radius:8px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none">Compléter mon inscription →</a></td></tr></table>
<p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#4b455b">Une question ? Répondez simplement à cet email.<br>À bientôt,<br><b>L’équipe Celexia</b></p>
</td></tr><tr><td style="padding:22px 32px;border-top:1px solid #ece8f2;background:#faf9fc;font-size:11px;line-height:1.7;color:#71697e">Si le bouton ne s’ouvre pas, copiez ce lien dans votre navigateur :<br><a href="${h(lien)}" style="color:#6d28d9;word-break:break-all">${h(lien)}</a><br><br>Celexia · Mise en relation entre clients et entreprises du bâtiment</td></tr>
</table></td></tr></table></body></html>`
  return { subject, html, lien, bonjour }
}
