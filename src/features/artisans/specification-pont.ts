/**
 * Spécification d'intégration, à remettre à l'artisan.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le CRM de l'artisan n'est pas le nôtre : on ne peut pas y toucher. Ce qu'on
 * peut faire, c'est lui donner un document assez précis pour que son propre
 * assistant de code l'implémente sans nous poser de question. C'est le
 * livrable central du pont — le reste n'est que tuyauterie.
 *
 * Il est GÉNÉRÉ, pas rédigé une fois pour toutes : les jetons, la clé et le
 * secret y figurent déjà à leur place. Un document générique obligerait
 * l'artisan à faire lui-même la substitution, et c'est précisément là que les
 * intégrations échouent.
 */

export interface ContextePont {
  societe: string
  /** Jeton d'espace artisan — donne accès à la totalité de son pipe. */
  tokenArtisan: string
  clePublique: string
  secret: string
  urlWebhook: string | null
  supabaseUrl: string
  cleAnon: string
}

/** Étapes déclarables, dans l'ordre du funnel. */
export const ETAPES_PONT = [
  'contacte',
  'rdv_pris',
  'devis_envoye',
  'devis_signe',
  'termine',
] as const

/** Résultats d'appel admis (`log_appel_by_token`). */
export const RESULTATS_APPEL = [
  'pas_de_reponse',
  'repondu',
  'rappeler',
  'faux_numero',
] as const

/** Emplacements de montant et de devis (`set_montant_by_token`). */
export const SLOTS_PONT = ['devis', 'devis_signe'] as const

/**
 * Les dix actions du pont — exactement celles de l'espace artisan.
 *
 * Cette liste est le CŒUR de la notice. Un pont qui n'en couvrirait qu'une
 * partie obligerait l'artisan à revenir dans le portail pour le reste,
 * c'est-à-dire à refaire la double saisie qu'on voulait supprimer.
 */
export const ACTIONS_PONT: {
  type: string
  quand: string
  champs: string
  portail: string
}[] = [
  {
    type: 'statut',
    quand: 'J’avance dans le funnel',
    champs: 'p_statut, p_message, p_date_rdv, p_montant',
    portail: 'les boutons d’étape',
  },
  {
    type: 'note',
    quand: 'Je commente sans changer d’étape',
    champs: 'p_message',
    portail: 'le fil de discussion',
  },
  {
    type: 'correction',
    quand: 'Je me suis trompé et je reviens en arrière',
    champs: 'p_statut',
    portail: 'la correction d’étape',
  },
  {
    type: 'montant',
    quand: 'Je saisis le montant — du devis **ou du devis signé**',
    champs: 'p_montant, p_slot (`devis` ou `devis_signe`)',
    portail: 'les deux champs montant',
  },
  {
    type: 'devis',
    quand: 'Je dépose le PDF — devis **ou devis signé**',
    champs: 'p_url, p_slot (`devis` ou `devis_signe`)',
    portail: 'les deux zones de dépôt',
  },
  {
    type: 'rappel',
    quand: 'Le client me dit « rappelle-moi le… »',
    champs: 'p_quand (nul = annule le rappel)',
    portail: 'le mode rappel',
  },
  {
    type: 'appel',
    quand: 'J’ai tenté de joindre le client',
    champs: 'p_resultat, p_message',
    portail: 'le bouton d’appel',
  },
  {
    type: 'perdu',
    quand: 'J’abandonne le chantier',
    champs: 'p_motif ET p_message (≥ 5 caractères)',
    portail: 'le retrait du chantier',
  },
  {
    type: 'restauration',
    quand: 'Je récupère un chantier que j’avais abandonné',
    champs: '—',
    portail: 'les chantiers perdus',
  },
  {
    type: 'lu',
    quand: 'J’ai lu les messages de l’agence',
    champs: '—',
    portail: 'l’ouverture du fil',
  },
]

/** Motifs d'abandon admis. Liste fermée, imposée par la base (0079). */
export const MOTIFS_PONT = [
  'hors_zone',
  'doublon',
  'hors_competence',
  'delai_incompatible',
  'prix_trop_eleve',
  'budget_insuffisant',
  'signe_concurrent',
  'client_injoignable',
  'client_renonce',
  'non_eligible_aides',
] as const

export function specificationPont(c: ContextePont): string {
  const rpc = `${c.supabaseUrl}/rest/v1/rpc`
  const webhook =
    c.urlWebhook?.trim() ||
    '<URL À DÉFINIR — dis-la-moi, je la renseignerai côté Celexia>'

  const tableauActions = ACTIONS_PONT.map(
    (a) => `| \`${a.type}\` | ${a.quand} | ${a.champs} | ${a.portail} |`,
  ).join('\n')

  return `# Brancher mon CRM sur celui de Celexia

Tu vas modifier mon CRM pour qu'il se synchronise avec celui de Celexia, mon
apporteur d'affaires. Aujourd'hui je reçois leurs chantiers dans leur portail
web et je dois ressaisir chez moi — c'est cette double saisie qu'on supprime.

**Objectif : je ne dois plus JAMAIS avoir à ouvrir leur portail.** Tout ce que
j'y fais aujourd'hui doit exister dans mon CRM et repartir chez eux
automatiquement. La partie 3 liste ces actions une par une — il n'y en a pas
une seule d'optionnelle, sinon je devrai retourner sur leur site pour
celle-là, et on n'aura rien gagné.

Trois parties, à faire dans cet ordre :

1. **Lire** leur pipe (lecture seule, sans risque)
2. **Recevoir** leurs événements en temps réel
3. **Renvoyer** chacune de mes modifications

---

## Mes identifiants

| Quoi | Valeur |
|---|---|
| Base de l'API Celexia | \`${rpc}\` |
| Clé publique de l'API (en-tête \`apikey\`) | \`${c.cleAnon}\` |
| Mon jeton d'espace artisan | \`${c.tokenArtisan}\` |
| Ma clé de pont | \`${c.clePublique}\` |
| Mon secret de signature | \`${c.secret}\` |
| URL de MON webhook (où Celexia me pousse les événements) | \`${webhook}\` |

⚠️ Le secret de signature ne doit jamais se retrouver dans du code côté
navigateur ni dans un dépôt public. Range-le en variable d'environnement.

---

## PARTIE 1 — Lire mon pipe

Un seul appel renvoie la totalité de mes chantiers :

\`\`\`http
POST ${rpc}/get_espace_artisan
apikey: ${c.cleAnon}
Content-Type: application/json

{ "p_token": "${c.tokenArtisan}" }
\`\`\`

La réponse contient \`projets\`, un tableau de chantiers. **Chaque chantier
porte un champ \`token\`** — c'est la clé d'écriture de la partie 3.
Conserve-le en base chez moi, à côté de mon propre identifiant de chantier :
c'est la correspondance entre les deux CRM. Sans lui, je ne peux rien renvoyer.

Champs d'un chantier :

| Champ | Sens |
|---|---|
| \`id\` | Identifiant Celexia de l'affectation |
| \`token\` | **Clé d'écriture** — à conserver, à ne jamais exposer |
| \`etape\` | \`contacte\` → \`rdv_pris\` → \`devis_envoye\` → \`devis_signe\` → \`termine\` |
| \`issue\` | \`en_cours\` / \`gagne\` / \`perdu\` |
| \`en_attente_depuis\` | Non nul = en pause, sans perte d'avancement |
| \`rappel_le\` | Rappel programmé |
| \`retire_at\` | Non nul = le chantier m'a été repris, je n'y touche plus |
| \`metier\`, \`sous_metier\`, \`description\`, \`budget_estime\` | La demande |
| \`client_nom\`, \`client_telephone\`, \`client_email\`, \`client_adresse\` | Coordonnées — **nulles tant que mon contrat n'est pas signé** |
| \`client_ville\`, \`client_code_postal\` | Localisation |
| \`montant_devis\`, \`montant_devis_signe\` | Mes montants |
| \`devis_depose\`, \`devis_signe_depose\` | Un PDF est-il déjà déposé |
| \`date_rdv\`, \`recu_le\`, \`derniere_activite\` | Dates |

Lance cet appel une fois au démarrage pour te synchroniser, puis laisse la
partie 2 prendre le relais. Une relecture complète par jour est une bonne
sécurité au cas où un événement se serait perdu.

---

## PARTIE 2 — Recevoir leurs événements

Expose un endpoint HTTPS chez moi. Celexia y enverra un POST à chaque
événement. Il doit répondre **2xx en moins de 10 secondes** — traite en tâche
de fond si besoin, ne fais pas attendre la réponse.

**Corps reçu :**

\`\`\`json
{
  "evenement_id": "4127",
  "type": "chantier_attribue",
  "emis_le": "2026-09-05T14:32:07Z",
  "tentative": 1,
  "donnees": { "... un chantier, au format exact de la partie 1 ..." }
}
\`\`\`

**En-têtes reçus :**

| En-tête | Contenu |
|---|---|
| \`X-Celexia-Cle\` | \`${c.clePublique}\` — vérifie que c'est bien la mienne |
| \`X-Celexia-Evenement\` | Identique à \`evenement_id\` |
| \`X-Celexia-Signature\` | \`HMAC-SHA256(corps brut, secret)\` en hexadécimal minuscule |

**Types reçus :**

| Type | Sens | Ce que mon CRM doit faire |
|---|---|---|
| \`chantier_attribue\` | Un lead m'est attribué, ou restauré | Créer la fiche, ou la rouvrir |
| \`chantier_retire\` | Le chantier m'est repris | Clore la fiche, arrêter les relances |
| \`message_agence\` | Celexia m'écrit | Enregistrer le message ; \`donnees.chantier\` porte l'état à jour |
| \`ping\` | Test de connexion | Répondre 2xx et **ne rien créer** |

### Les trois règles à ne pas rater

**Vérifie la signature.** Calcule \`HMAC-SHA256\` sur le **corps brut de la
requête, avant tout parsing JSON**, avec mon secret. Compare en temps constant
à \`X-Celexia-Signature\`. Si ça ne correspond pas : 401, et n'applique rien.

**Déduplique sur \`evenement_id\`.** Celexia garantit qu'un événement finit par
arriver, PAS qu'il n'arrive qu'une fois — un accusé perdu sur le réseau
provoque un renvoi. Garde une table des identifiants traités ; si
\`evenement_id\` y figure, réponds 200 sans rien refaire. Sans ça, un chantier
sera créé en double.

**Réponds 2xx même pour un événement ignoré.** Une erreur déclenche des
réessais pendant une heure, puis un abandon signalé côté Celexia. Ne réserve
les codes d'erreur qu'aux vraies pannes.

---

## PARTIE 3 — Renvoyer mes modifications

**C'est la partie qui compte.** Tout ce que je fais aujourd'hui dans leur
portail doit partir d'ici. Un seul endpoint pour les dix actions :

\`\`\`http
POST ${rpc}/pont_entrant
apikey: ${c.cleAnon}
Content-Type: application/json

{
  "p_token": "<le token DU CHANTIER, récupéré en partie 1>",
  "p_evenement_id": "<identifiant stable, généré par mon CRM>",
  "p_type": "statut",
  "p_statut": "devis_envoye",
  "p_message": "Devis parti par mail",
  "p_montant": 12400
}
\`\`\`

N'envoie que les champs utiles à l'action ; les autres sont optionnels.

### Les dix actions — aucune n'est optionnelle

| \`p_type\` | Quand | Champs qui comptent | Équivaut dans le portail à |
|---|---|---|---|
${tableauActions}

### Les devis : deux documents distincts, ne les confonds pas

C'est le point sur lequel une intégration se plante le plus souvent, et celui
qui coûte le plus cher.

| | Emplacement | Ce que c'est |
|---|---|---|
| Le devis que j'envoie au client | \`devis\` | Ma proposition |
| Le devis que le client me retourne signé | \`devis_signe\` | **La preuve de l'affaire — c'est lui qui déclenche la commission** |

**Déposer sur \`devis_signe\` vaut déclaration de signature.** Celexia passe le
chantier en « devis signé » automatiquement quand je dépose là. Je n'ai donc
pas besoin d'envoyer un \`statut\` en plus — mais je peux, ça ne fait pas de mal.

Même chose pour le montant : \`p_slot: "devis_signe"\` enregistre le montant
réellement signé, pas la proposition.

⚠️ Si j'omets \`p_slot\` sur un type \`devis\`, le document part sur \`devis\` — la
proposition. **Le devis signé se dit toujours explicitement.**

### Téléverser le PDF

\`p_url\` attend une URL. Deux façons de l'obtenir.

**Option A — je téléverse chez Celexia** (recommandé : le document reste chez
eux, il survit à mes propres changements d'hébergement).

\`\`\`http
POST ${c.supabaseUrl}/storage/v1/object/devis/<TOKEN_DU_CHANTIER>/devis_signe-<aleatoire>.pdf
apikey: ${c.cleAnon}
Content-Type: application/pdf

<octets du PDF>
\`\`\`

Le premier segment du chemin **doit** être le token du chantier — c'est ce
qui autorise le dépôt. L'URL à renvoyer ensuite est :

\`${c.supabaseUrl}/storage/v1/object/public/devis/<TOKEN_DU_CHANTIER>/<nom du fichier>\`

Ajoute un suffixe aléatoire au nom : deux dépôts successifs ne doivent pas
s'écraser.

**Option B — j'héberge le PDF moi-même** et j'envoie mon URL. Elle doit rester
accessible dans la durée : Celexia ne fait que stocker le lien, si mon serveur
change le document devient introuvable de leur côté.

### Vocabulaires imposés

\`p_statut\` — ${ETAPES_PONT.map((e) => `\`${e}\``).join(' → ')}, plus
\`en_attente\` (drapeau de pause : il n'efface pas l'avancement acquis).

\`p_slot\` — ${SLOTS_PONT.map((s) => `\`${s}\``).join(' ou ')}. Omis, il est
déduit : \`devis_signe\` si le statut envoyé est une signature, \`devis\` sinon.

\`p_resultat\` (appels) — ${RESULTATS_APPEL.map((r) => `\`${r}\``).join(', ')}.

\`p_motif\` (abandon) — ${MOTIFS_PONT.map((m) => `\`${m}\``).join(', ')}.

Écris une **table de correspondance** entre MES statuts et les leurs, noir sur
blanc dans le code. Si un de mes statuts n'a pas d'équivalent, envoie l'étape
la plus proche en dessous plus une \`note\` explicative — ne l'invente pas,
elle serait rejetée.

### Raccourci utile

Signer un devis, c'est une étape ET un montant. Envoie les deux dans le même
appel : \`p_type: "statut"\`, \`p_statut: "devis_signe"\`, \`p_montant: 12400\`.
Le montant part sur \`devis_signe\` automatiquement. Deux appels séparés
marchent aussi, mais c'est une occasion de plus pour que l'un des deux se perde.

### Ce que je peux écrire, et ce que je ne peux pas

Je fais autorité sur **l'avancement de mon chantier** : étape, montants, devis,
RDV, rappel, appels, abandon. Celexia fait autorité sur **la propriété du
lead** : à qui il est attribué, s'il m'est repris, la commission. Je n'essaie
pas d'écrire ces champs-là.

### Idempotence, de mon côté aussi

\`p_evenement_id\` doit être **stable et unique par changement**. Si mon CRM
rejoue le même appel (réseau coupé, tâche relancée), Celexia renvoie le
résultat d'origine sans rien réécrire — à condition que l'identifiant soit le
même. Bonne recette : \`<id du chantier chez moi>-<horodatage du changement>\`.
Surtout pas un UUID tiré à chaque tentative : ça créerait un doublon à chaque
réessai.

### Lire la réponse

\`{ "ok": true }\` → c'est passé.
\`{ "ok": false, "error": "..." }\` → ce n'est **pas** passé, malgré le HTTP 200.

| \`error\` | Cause | À faire |
|---|---|---|
| \`token_invalide\` | Chantier disparu, ou j'en ai été retiré | Refaire une partie 1 |
| \`pont_inactif\` | Celexia a coupé le pont | Arrêter d'envoyer, les prévenir |
| \`type_inconnu\` | Type hors liste | La réponse donne \`types_admis\` |
| \`statut_non_autorise\` | Statut hors vocabulaire | Corriger la correspondance |
| \`motif_invalide\` | Motif hors liste | La réponse donne \`motifs_admis\` |
| \`resultat_invalide\` | Résultat d'appel hors liste | La réponse donne \`resultats_admis\` |
| \`slot_invalide\` | Ni \`devis\` ni \`devis_signe\` | Corriger |
| \`motif_requis\` / \`justification_requise\` | Abandon sans motif ou texte < 5 caractères | Compléter |
| \`statut_requis\` / \`montant_requis\` / \`url_requise\` | Champ manquant pour ce type | Bug chez moi |
| \`evenement_id_requis\` | Identifiant vide | Bug chez moi |

**Réessaie** sur erreur réseau ou HTTP 5xx, avec un recul progressif.
**Ne réessaie pas** sur un refus de vocabulaire : c'est un bug de
correspondance, réessayer ne le corrigera pas.

---

## COMMENT ON TESTE

Dans cet ordre, en s'arrêtant au premier qui échoue.

### Étape A — je lis (aucun risque)

1. \`get_espace_artisan\` répond et renvoie mes chantiers.
2. Chaque chantier a bien un \`token\`, et je le stocke chez moi.

### Étape B — je reçois

3. Celexia clique **« Tester la connexion »** sur ma fiche. Je dois voir
   arriver un événement \`ping\`, et de leur côté l'écran doit afficher
   **HTTP 200**. Si ça échoue, tout le reste est inutile — c'est le test qui
   isole le tuyau du métier.
4. Je poste sur mon webhook avec une **mauvaise signature** → mon endpoint
   doit répondre **401** et ne rien créer.
5. Je rejoue **deux fois** le même \`evenement_id\` entrant → **une seule**
   fiche créée.
6. Celexia m'attribue un chantier de test → il apparaît chez moi tout seul,
   avec les bonnes coordonnées client.

### Étape C — je renvoie

7. Je change l'étape chez moi → ils la voient. Ils vérifient dans le journal
   « Dernières réceptions » de ma fiche.
8. Je renvoie **deux fois** le même \`p_evenement_id\` → **un seul** effet chez
   eux, pas de doublon dans leur fil.
9. **Le devis signé, en particulier.** Je téléverse un PDF, je l'envoie avec
   \`p_slot: "devis_signe"\`, et ils vérifient chez eux que : le document est
   visible, le chantier est passé en « devis signé », et le montant signé est
   le bon. Si le document n'apparaît pas alors que la réponse disait \`ok\`,
   c'est que j'ai envoyé \`devis\` au lieu de \`devis_signe\`.
10. Je passe en revue **les dix actions** une par une : statut, note,
    correction, montant, devis, rappel, appel, abandon, restauration, lu. Pour
    chacune, ils confirment de leur côté. C'est long, mais c'est la seule façon
    de savoir que je n'aurai plus jamais à rouvrir leur portail.
11. J'envoie un statut volontairement faux (\`p_statut: "nimportequoi"\`) →
    refus propre avec la liste, et mon CRM ne réessaie pas en boucle.

### Étape D — je coupe

12. Celexia coupe le pont → mes appels reçoivent \`pont_inactif\`, et mon CRM
    le signale au lieu de perdre les changements en silence.

Les points 5, 8 et 11 sont ceux qu'on oublie, et ce sont eux qui font les
doublons et les boucles infinies. Le point 9 est celui qui coûte de l'argent.
Teste-les vraiment.
`
}
