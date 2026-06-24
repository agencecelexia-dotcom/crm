// Le corps peut arriver en JSON (application/json) OU en texte brut
// (le navigateur en mode no-cors force text/plain) → on parse dans les deux cas.
let d = $input.first().json.body;
if (d === undefined || d === null) d = $input.first().json;
if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
d = d || {};

// Envoi d'un devis EN PIÈCE JOINTE (PDF en base64) → routé vers le node Gmail
// "Envoyer devis PDF" via le IF sur has_pdf. Doit être traité en premier.
if (d.event === 'envoyer_devis_pdf') {
  if (!d.email || !d.pdf_base64) return [];
  return [{
    json: {
      to: d.email,
      subject: d.subject || ('Votre devis ' + (d.numero || '')),
      html: d.html || '<p>Bonjour,<br><br>Votre devis est en pièce jointe.<br><br>Celexia</p>',
      has_pdf: true,
    },
    binary: { devis: { data: d.pdf_base64, mimeType: 'application/pdf', fileName: d.filename || 'devis.pdf' } },
  }];
}

// Relances INTERNES coupées (escalade « à appeler » + digest leads orphelins) — trop fréquentes.
if (d.event === 'escalade' || d.event === 'lead_orphelin') return [];

const AGENCE = 'agence.celexia@gmail.com';
const LOGO = 'https://crm-ci7k.vercel.app/logo.png';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Casse normalisée (évite le TOUT-MAJUSCULES) : "ZACHARI" → "Zachari".
const capG = (s) => esc(s).toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());
const salutG = (d) => {
  const p = (d.artisan_prenom || '').trim(), n = (d.artisan_nom || '').trim();
  return p ? ('Bonjour ' + capG(p)) : (n ? ('Bonjour Monsieur ' + capG(n)) : 'Bonjour');
};

// Gabarit email branché (violet Celexia), compatible clients mail.
const frame = (inner) => `
<div style="background:#f4f4f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ececf1;">
    <div style="background:#7C3AED;padding:22px;text-align:center;">
      <img src="${LOGO}" alt="Celexia" height="26" style="height:26px;display:inline-block;" />
    </div>
    <div style="padding:26px 28px;">${inner}</div>
    <div style="padding:14px 28px;border-top:1px solid #f0f0f4;text-align:center;color:#9ca3af;font-size:12px;">
      Celexia — mise en relation client ↔ artisan
    </div>
  </div>
</div>`;

const btn = (href, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 18px;">
  <tr><td style="border-radius:10px;background:#7C3AED;">
    <a href="${href}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">${label}</a>
  </td></tr>
</table>`;

let to = AGENCE, subject, html;

if (d.event === 'envoyer_lien_mission') {
  to = d.email;                 // ➜ destinataire = l'ARTISAN
  if (!to) return [];           // pas d'email artisan → on n'envoie rien

  // Salutation : prénom si dispo, sinon "Monsieur <nom>".
  // Casse normalisée (évite le TOUT-MAJUSCULES) : "ZACHARI" → "Zachari".
  const cap = (s) => esc(s).toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());
  const hasPrenom = (d.artisan_prenom || '').trim() !== '';
  const hasNom = (d.artisan_nom || '').trim() !== '';
  const salut = hasPrenom
    ? ('Bonjour ' + cap(d.artisan_prenom))
    : (hasNom ? ('Bonjour Monsieur ' + cap(d.artisan_nom)) : 'Bonjour');

  // Aperçu projet SANS identité client (ni nom, ni téléphone) : ville + type + description.
  const lignes = [];
  if (d.client_ville) lignes.push('<b>Ville :</b> ' + esc(d.client_ville));
  if (d.metiers) lignes.push('<b>Projet :</b> ' + esc(d.metiers));
  if (d.description) lignes.push('<b>Description :</b> ' + esc(d.description));
  const box = lignes.length
    ? `<div style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:12px;padding:16px;margin:0 0 16px;">
         <p style="margin:0 0 8px;font-weight:bold;color:#5b21b6;font-size:14px;">Le projet</p>
         ${lignes.map((l) => `<p style="margin:0 0 4px;color:#374151;font-size:14px;">${l}</p>`).join('')}
       </div>`
    : '';

  subject = 'Votre dossier client Celexia';
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:20px;color:#111827;">${salut},</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Un nouveau chantier vous est proposé par Celexia. Les coordonnées du client vous seront communiquées dès la signature de votre contrat, dans votre espace :</p>
    ${btn(esc(d.lien), 'Accéder à mon espace →')}
    ${box}
    <ol style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.7;">
      <li>Signez votre contrat d'engagement (au doigt, 1 min).</li>
      <li>Découvrez alors les coordonnées du client et contactez-le.</li>
      <li>Déposez votre devis, puis le devis signé.</li>
    </ol>
    <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">Si le bouton ne fonctionne pas, copiez ce lien :<br>
      <a href="${esc(d.lien)}" style="color:#7C3AED;word-break:break-all;">${esc(d.lien)}</a>
    </p>`);
} else if (d.event === 'contrat_signe') {
  subject = '✍️ Contrat signé — ' + (d.societe || d.artisan || 'Artisan');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:18px;color:#111827;">Contrat signé ✍️</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;"><b>${esc(d.artisan)}</b>${d.societe ? ' (' + esc(d.societe) + ')' : ''} vient de signer son contrat d'engagement${d.signataire ? ' — signataire : ' + esc(d.signataire) : ''}.</p>
    ${d.lien ? btn(esc(d.lien), 'Ouvrir la fiche artisan →') : ''}`);
} else if (d.event === 'devis_depose') {
  const label = d.type === 'devis_signe' ? 'Devis SIGNÉ' : 'Devis';
  subject = '📄 ' + label + ' déposé — ' + (d.client_nom || 'Client');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:18px;color:#111827;">${label} déposé 📄</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Déposé par <b>${esc(d.artisan)}</b>${d.societe ? ' (' + esc(d.societe) + ')' : ''} pour le client <b>${esc(d.client_nom)}</b> (${esc(d.metier)}${d.client_ville ? ', ' + esc(d.client_ville) : ''}).</p>
    ${d.lien ? btn(esc(d.lien), 'Ouvrir le projet →') : ''}
    <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">Pense à valider l'encaissement de la commission une fois reçue (case « Commission encaissée »).</p>`);
} else if (d.event === 'changement_statut') {
  const LABELS = {
    contacte: 'Client contacté', rdv_pris: 'RDV pris', en_attente: 'En attente',
    devis_envoye: 'Devis envoyé', devis_signe: 'Devis signé',
    termine: 'Projet terminé', perdu: 'Pas de suite / Perdu',
  };
  const st = LABELS[d.statut] || d.statut || 'Mise à jour';
  subject = '🔔 ' + st + ' — ' + (d.client_nom || 'Client') + (d.artisan ? ' (' + d.artisan + ')' : '');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:18px;color:#111827;">Nouveau statut : ${esc(st)} 🔔</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;"><b>${esc(d.artisan || 'Un artisan')}</b> a mis à jour le projet <b>${esc(d.client_nom || '')}</b>${d.metier ? ' (' + esc(d.metier) + (d.client_ville ? ', ' + esc(d.client_ville) : '') + ')' : ''} en <b>${esc(st)}</b>.</p>
    ${d.lien ? btn(esc(d.lien), 'Ouvrir le projet →') : ''}`);
} else if (d.event === 'relance_contrat') {
  to = d.email; if (!to) return [];           // ➜ artisan
  subject = '⏰ Un chantier vous attend — signez en 2 min';
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:19px;color:#111827;">${salutG(d)},</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Un chantier${d.metier ? ' <b>' + esc(d.metier) + '</b>' : ''}${d.client_ville ? ' à <b>' + esc(d.client_ville) + '</b>' : ''} vous a été attribué et <b>attend votre signature</b>.</p>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Signez votre contrat en 2 min : <b>les coordonnées du client se débloquent immédiatement</b>.</p>
    ${btn(esc(d.lien), 'Signer et accéder au client →')}
    <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">Plus vous êtes rapide, plus vous avez de chances de signer le devis.</p>`);
} else if (d.event === 'relance_inaction') {
  to = d.email; if (!to) return [];           // ➜ artisan
  subject = '🔔 ' + (d.client_nom ? esc(d.client_nom) + ' attend votre action' : 'Un chantier attend votre action');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:19px;color:#111827;">${salutG(d)},</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Le chantier <b>${esc(d.client_nom || '')}</b> attend votre prochaine action${d.statut ? ' (statut : ' + esc(d.statut) + ')' : ''}. <b>Le client est chaud</b> — recontactez-le et mettez à jour votre avancement.</p>
    ${btn(esc(d.lien), 'Ouvrir mon espace →')}`);
} else if (d.event === 'relance_post_rdv') {
  to = d.email; if (!to) return [];           // ➜ artisan
  const chantier = d.client_nom || ((d.metier || '') + (d.client_ville ? ' à ' + d.client_ville : '')) || 'votre rendez-vous';
  subject = d.rappel > 1 ? '⏰ Rappel : comment s\'est passé votre RDV ?' : 'Comment s\'est passé votre rendez-vous ?';
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:19px;color:#111827;">${salutG(d)},</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Vous aviez un rendez-vous pour le chantier <b>${esc(chantier)}</b>. <b>Comment ça s'est passé ?</b></p>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Mettez à jour votre avancement en 30 secondes — et <b>si vous avez fait un devis, pensez à le déposer</b> dans votre espace :</p>
    ${btn(esc(d.lien), 'Mettre à jour mon RDV →')}
    <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">Quelques mots sur le rendez-vous (besoin, budget, prochaine étape) nous aident à vous accompagner.</p>`);
} else if (d.event === 'envoyer_devis') {
  to = d.email; if (!to) return [];           // ➜ CLIENT
  const cap = (s) => esc(s).toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());
  const bonjour = (d.client_nom || '').trim() ? ('Bonjour ' + cap(d.client_nom)) : 'Bonjour';
  const montant = d.montant != null ? Number(d.montant).toLocaleString('fr-FR') + ' €' : '';
  subject = 'Votre devis ' + esc(d.numero || '') + (d.artisan ? ' — ' + esc(d.artisan) : '');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:19px;color:#111827;">${bonjour},</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Voici votre devis${d.artisan ? ' de la part de <b>' + esc(d.artisan) + '</b>' : ''}${montant ? ' — <b>' + montant + '</b>' : ''}. Vous pouvez le consulter et le télécharger ici :</p>
    ${btn(esc(d.lien), 'Voir / télécharger le devis →')}
    <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">Pour valider, répondez à cet email ou retournez le devis signé avec la mention « Bon pour accord ».</p>
    <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">Si le bouton ne fonctionne pas, copiez ce lien :<br><a href="${esc(d.lien)}" style="color:#7C3AED;word-break:break-all;">${esc(d.lien)}</a></p>`);
} else if (d.event === 'escalade') {
  const motif = d.sujet === 'contrat' ? 'n\'a toujours pas signé son contrat' : 'n\'a pas avancé sur le chantier';
  const chantier = d.client_nom || ((d.metier || '') + (d.client_ville ? ' à ' + d.client_ville : '')) || 'le chantier';
  subject = '⚠️ À appeler : ' + esc(d.artisan || 'Artisan');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:18px;color:#111827;">⚠️ Action requise — à appeler</h1>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;"><b>${esc(d.artisan || 'Un artisan')}</b> ${motif} sur <b>${esc(chantier)}</b> depuis +48 h. Mieux vaut l'appeler directement (ou réattribuer le chantier).</p>
    ${d.lien ? btn(esc(d.lien), 'Ouvrir le projet →') : ''}`);
} else if (d.event === 'lead_orphelin') {
  const list = Array.isArray(d.projets) ? d.projets : [];
  if (!list.length) return [];
  const rows = list.map((p) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f4;font-size:14px;color:#374151;">${esc(p.client || '?')}${p.ville ? ' · ' + esc(p.ville) : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f4;font-size:14px;color:#6b7280;">${esc(p.metier || '')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f4;font-size:14px;color:#111827;text-align:right;">${p.budget != null ? esc(p.budget) + ' €' : '—'}</td>
    </tr>`).join('');
  subject = '📥 ' + list.length + ' lead(s) à attribuer';
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:18px;color:#111827;">Leads non attribués (+24 h) 📥</h1>
    <p style="margin:0 0 10px;color:#374151;font-size:15px;line-height:1.5;">${list.length} projet(s) attendent un artisan, triés par budget :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>
    ${btn('https://crm-ci7k.vercel.app/projets', 'Attribuer maintenant →')}`);
} else if (d.event === 'rappel_interne') {
  to = d.to || AGENCE;                         // ➜ équipe interne (boîte agence par défaut)
  const nom = (d.pour || '').trim();
  const qui = nom ? capG(nom).toUpperCase() : '';
  subject = '🔔 ' + (qui ? qui + ' ' : '') + "T'AS DU TAFF !" + (d.titre ? ' — ' + d.titre : '');
  html = frame(`
    <h1 style="margin:0 0 12px;font-size:21px;color:#111827;">🔔 ${qui ? esc(qui) + ", t'as du taff !" : "T'as du taff !"}</h1>
    <p style="margin:0 0 8px;color:#111827;font-size:16px;line-height:1.5;font-weight:bold;">${esc(d.titre)}</p>
    ${d.details ? `<p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.6;">${esc(d.details)}</p>` : ''}
    ${d.echeance ? `<p style="margin:0 0 6px;color:#6b7280;font-size:13px;">⏰ Pour le <b>${esc(d.echeance)}</b></p>` : ''}
    ${d.lien ? btn(esc(d.lien), 'Ouvrir dans le CRM →') : ''}`);
} else if (d.event === 'bienvenue_espace') {
  to = d.email; if (!to) return [];            // ➜ l'ARTISAN qui vient de signer
  subject = '🎉 Bienvenue chez Celexia — votre espace partenaire';
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:20px;color:#111827;">${salutG(d)},</h1>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.5;">Merci, votre contrat d'engagement est <b>signé</b> ✅. Voici votre <b>espace partenaire</b> Celexia.</p>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Pour l'instant il n'y a pas encore de chantier. Dès que nous vous en attribuons un, <b>il apparaîtra directement ici</b> — nous vous appellerons pour vous prévenir.</p>
    ${btn(esc(d.lien), 'Accéder à mon espace →')}
    <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">Pensez à enregistrer notre numéro : <b>Antoine apporteur d'affaires</b>.</p>`);
} else if (d.event === 'nouvel_artisan_inscrit') {
  // ➜ interne (boîte agence par défaut)
  const canal = capG(d.canal || 'le lien');
  subject = '🆕 Nouvel artisan inscrit via ' + canal + ' — ' + (d.societe || d.nom || 'Artisan');
  html = frame(`
    <h1 style="margin:0 0 10px;font-size:18px;color:#111827;">🆕 Nouvel artisan inscrit via ${esc(canal)}</h1>
    <p style="margin:0 0 6px;color:#111827;font-size:15px;"><b>${esc(d.nom)}</b>${d.societe ? ' — ' + esc(d.societe) : ''}</p>
    ${d.metiers ? `<p style="margin:0 0 4px;color:#374151;font-size:14px;"><b>Métiers :</b> ${esc(d.metiers)}</p>` : ''}
    <p style="margin:0 0 4px;color:#374151;font-size:14px;">${d.ville ? '<b>Ville :</b> ' + esc(d.ville) : ''}${d.telephone ? ' &nbsp;·&nbsp; <b>Tél :</b> ' + esc(d.telephone) : ''}</p>
    ${d.email ? `<p style="margin:0 0 4px;color:#374151;font-size:14px;"><b>Email :</b> ${esc(d.email)}</p>` : ''}
    ${d.lien ? btn(esc(d.lien), 'Ouvrir la fiche artisan →') : ''}`);
} else {
  return []; // événement inconnu → aucun envoi
}

return [{ json: { to, subject, html } }];
