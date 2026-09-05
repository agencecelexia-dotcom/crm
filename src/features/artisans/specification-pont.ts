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
  const webhook = c.urlWebhook?.trim() || '<URL À DÉFINIR — dis-la-moi, je la renseignerai côté Celexia>'

  return `# Brancher mon CRM sur celui de Celexia

Tu vas modifier mon CRM pour qu'il se synchronise avec celui de Celexia, mon
apporteur d'affaires. Aujourd'hui je reçois leurs chantiers dans leur portail
web et je dois ressaisir chez moi — c'est cette double saisie qu'on supprime.

Deux sens, indépendants l'un de l'autre. Implémente-les dans cet ordre : le
sens « je reçois » d'abord (il est en lecture seule, donc sans risque), le sens
« j'envoie » ensuite.

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
navigateur, ni dans un dépôt public. Range-le en variable d'environnement.

---

## SENS 1 — Recevoir les chantiers de Celexia

### 1.a Lire tout mon pipe (à faire en premier)

Un seul appel renvoie la totalité de mes chantiers, avec mes statistiques :

\`\`\`http
POST ${rpc}/get_espace_artisan
apikey: ${c.cleAnon}
Content-Type: application/json

{ "p_token": "${c.tokenArtisan}" }
\`\`\`

La réponse contient \`projets\`, un tableau de chantiers. **Chaque chantier
porte un champ \`token\`** — c'est lui qui sert à écrire (sens 2). Conserve-le
en base chez moi, à côté de mon propre identifiant de chantier : c'est la
clé de correspondance entre les deux CRM.

Champs utiles d'un chantier :

| Champ | Sens |
|---|---|
| \`id\` | Identifiant Celexia de l'affectation |
| \`token\` | **Clé d'écriture** — à conserver, ne jamais l'exposer publiquement |
| \`etape\` | \`contacte\` → \`rdv_pris\` → \`devis_envoye\` → \`devis_signe\` → \`termine\` |
| \`issue\` | \`en_cours\` / \`gagne\` / \`perdu\` |
| \`retire_at\` | Non nul = le chantier m'a été repris, je n'y touche plus |
| \`metier\`, \`sous_metier\`, \`description\`, \`budget_estime\` | La demande |
| \`client_nom\`, \`client_telephone\`, \`client_email\`, \`client_adresse\` | Coordonnées — **nulles tant que mon contrat n'est pas signé** |
| \`client_ville\`, \`client_code_postal\` | Localisation |
| \`montant_devis\`, \`montant_devis_signe\` | Mes montants |
| \`date_rdv\`, \`rappel_le\`, \`en_attente_depuis\` | Dates |
| \`recu_le\` | Quand le chantier m'a été attribué |

Fais tourner cet appel une fois au démarrage pour te synchroniser, puis
laisse le sens 1.b prendre le relais. Une relecture complète par jour est une
bonne sécurité au cas où un événement se serait perdu.

### 1.b Recevoir les événements en temps réel

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
  "donnees": { ... un chantier, exactement au format du 1.a ... }
}
\`\`\`

**En-têtes reçus :**

| En-tête | Contenu |
|---|---|
| \`X-Celexia-Cle\` | \`${c.clePublique}\` — vérifie que c'est bien la mienne |
| \`X-Celexia-Evenement\` | Identique à \`evenement_id\` |
| \`X-Celexia-Signature\` | \`HMAC-SHA256(corps brut, secret)\` en hexadécimal minuscule |

**Types d'événement :**

| Type | Ce que ça veut dire | Ce que mon CRM doit faire |
|---|---|---|
| \`chantier_attribue\` | Un lead m'est attribué (ou restauré après retrait) | Créer la fiche, ou la rouvrir si elle existe déjà |
| \`chantier_retire\` | Le chantier m'est repris | Marquer la fiche comme close/perdue, arrêter les relances |
| \`message_agence\` | Celexia m'écrit sur un chantier | Enregistrer le message ; \`donnees.chantier\` porte l'état à jour |

### 1.c Les trois règles à ne pas rater

**Vérifie la signature.** Calcule \`HMAC-SHA256\` sur le **corps brut de la
requête, avant tout parsing JSON**, avec mon secret. Compare en temps
constant au contenu de \`X-Celexia-Signature\`. Si ça ne correspond pas :
réponds 401 et n'applique rien.

**Déduplique sur \`evenement_id\`.** Celexia garantit qu'un événement finit par
arriver, PAS qu'il n'arrive qu'une fois — un accusé de réception perdu sur le
réseau provoque un renvoi. Garde une table des identifiants déjà traités : si
\`evenement_id\` y figure, réponds 200 sans rien refaire. Sans ça, un chantier
sera créé en double.

**Réponds 2xx même pour un événement ignoré.** Un code d'erreur déclenche des
réessais toutes les quelques minutes pendant une heure, puis un abandon
signalé côté Celexia. Ne réserve les codes d'erreur qu'aux vraies pannes.

---

## SENS 2 — Renvoyer mes modifications à Celexia

Un seul appel, quoi que je change :

\`\`\`http
POST ${rpc}/pont_entrant
apikey: ${c.cleAnon}
Content-Type: application/json

{
  "p_token": "<le token DU CHANTIER, récupéré au 1.a>",
  "p_evenement_id": "<identifiant stable, généré par mon CRM>",
  "p_type": "statut",
  "p_statut": "devis_envoye",
  "p_message": "Devis parti par mail",
  "p_date_rdv": null,
  "p_montant_devis": 12400,
  "p_montant_devis_signe": null,
  "p_motif": null
}
\`\`\`

### Les quatre types

| \`p_type\` | Quand | Champs qui comptent |
|---|---|---|
| \`statut\` | J'avance dans le funnel | \`p_statut\`, \`p_message\`, \`p_date_rdv\`, montants |
| \`note\` | J'ajoute un commentaire sans changer d'étape | \`p_message\` |
| \`correction\` | Je me suis trompé et je REVIENS en arrière | \`p_statut\` |
| \`perdu\` | J'abandonne le chantier | \`p_motif\` **et** \`p_message\` (≥ 5 caractères) |

### Vocabulaire imposé

\`p_statut\` — ${ETAPES_PONT.map((e) => `\`${e}\``).join(' → ')}, plus
\`en_attente\` (drapeau de pause, qui n'efface pas l'avancement acquis).

\`p_motif\` — un seul de : ${MOTIFS_PONT.map((m) => `\`${m}\``).join(', ')}.
Toute autre valeur est refusée avec la liste en retour.

Fais une table de correspondance entre MES statuts et les leurs. Si un de mes
statuts n'a pas d'équivalent, envoie l'étape la plus proche en dessous plus
une \`note\` explicative — ne l'invente pas, elle serait rejetée.

### Ce que je peux écrire, et ce que je ne peux pas

Je fais autorité sur **l'avancement de mon chantier** : étape, montant du
devis, date de RDV, abandon motivé. Celexia fait autorité sur **la propriété
du lead** : à qui il est attribué, s'il m'est repris, la commission. Je
n'essaie pas d'écrire ces champs-là, ils seraient ignorés.

\`p_montant_devis_signe\` n'est accepté qu'à partir de l'étape
\`devis_signe\` — envoyé plus tôt, il est simplement ignoré.

### Idempotence, de mon côté aussi

\`p_evenement_id\` doit être **stable et unique par changement**. Si mon CRM
rejoue le même appel (réseau coupé, tâche relancée), Celexia renvoie le
résultat d'origine sans rien réécrire — à condition que l'identifiant soit le
même. Une bonne recette : \`<id du chantier chez moi>-<horodatage du
changement>\`. Surtout pas un UUID tiré à chaque tentative, ça créerait un
doublon à chaque réessai.

### Lire la réponse

\`{ "ok": true, ... }\` → c'est passé.
\`{ "ok": false, "error": "..." }\` → ce n'est PAS passé, malgré le code HTTP 200.

Erreurs possibles et ce qu'elles veulent dire :

| \`error\` | Cause | À faire |
|---|---|---|
| \`token_invalide\` | Le chantier n'existe plus, ou j'en ai été retiré | Refaire un 1.a pour resynchroniser |
| \`pont_inactif\` | Celexia a coupé le pont | Arrêter d'envoyer, les prévenir |
| \`evenement_id_requis\` | Champ vide | Bug chez moi |
| \`motif_invalide\` | Motif hors liste | La réponse contient \`motifs_admis\` |
| \`motif_requis\` / \`justification_requise\` | Abandon sans motif ou sans texte ≥ 5 caractères | Compléter |
| \`statut_non_autorise\` | Statut hors vocabulaire | Corriger la correspondance |

**Réessaie** sur erreur réseau ou HTTP 5xx, avec un recul progressif.
**Ne réessaie pas** sur \`motif_invalide\` ou \`statut_non_autorise\` : c'est un
bug de correspondance, réessayer ne le corrigera pas.

---

## Ce que je veux à la fin

1. Un endpoint webhook qui vérifie la signature, déduplique et applique les
   trois types d'événement.
2. Une synchro complète au démarrage et une fois par jour, via \`get_espace_artisan\`.
3. Un envoi vers \`pont_entrant\` à **chaque** changement d'étape, de montant ou
   de date de RDV, et à chaque abandon.
4. Une table de correspondance de statuts, écrite noir sur blanc dans le code.
5. Un journal des échanges — sans lui, on débogue à l'aveugle le jour où ça casse.

## Comment on teste

Dans l'ordre, en s'arrêtant au premier qui échoue :

1. \`get_espace_artisan\` renvoie mes chantiers et je vois bien les \`token\`.
2. Celexia m'attribue un chantier de test → il apparaît chez moi tout seul.
3. Je change son étape chez moi → Celexia la voit. (À vérifier avec eux.)
4. Je renvoie **deux fois** le même \`p_evenement_id\` → un seul effet, pas de doublon.
5. Je poste sur mon webhook avec une mauvaise signature → refusé en 401.
6. Je rejoue deux fois le même \`evenement_id\` entrant → une seule fiche créée.

Le point 4 et le point 6 sont ceux qu'on oublie et qui font les doublons.
Teste-les vraiment.
`
}
