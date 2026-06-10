// Le corps peut arriver en JSON (application/json) OU en texte brut
// (le navigateur en mode no-cors force text/plain) → on parse dans les deux cas.
let d = $input.first().json.body;
if (d === undefined || d === null) d = $input.first().json;
if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
d = d || {};
const AGENCE = 'agence.celexia@gmail.com';
const LOGO = 'https://crm-ci7k.vercel.app/logo.png';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
} else {
  return []; // événement inconnu → aucun envoi
}

return [{ json: { to, subject, html } }];
