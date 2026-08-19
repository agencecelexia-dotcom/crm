# Prompt pour Claude Cowork

---

Je veux automatiser l'entrée de mes leads Google Local Services Ads dans mon
CRM. Tu as accès à un navigateur : tu vas configurer Google Cloud puis n8n à ma
place, en me demandant de te donner la main uniquement pour les connexions et
les mots de passe.

## Le contexte

Je suis courtier en travaux (agence Celexia). Google LSA m'envoie des leads —
un client cherche un couvreur, Google me le transmet. Aujourd'hui je recopie
chaque numéro à la main dans mon CRM, plusieurs fois par jour.

Le mail de notification Google **ne contient pas le numéro** : juste « un client
potentiel vous a appelé le 19/08 à 09:52 ». Le numéro n'existe que dans le
tableau du site LSA et dans l'API. C'est donc l'API qu'il faut brancher.

La partie base de données est **déjà faite et testée** : une fonction
`ingerer_lead_externe` existe dans mon Supabase, elle crée la fiche et refuse
les doublons. Il ne reste que la configuration Google Cloud et le workflow n8n.

## Mes accès

- **Google** : `agence.celexia@gmail.com` (c'est le compte qui gère le LSA,
  numéro client `139-304-5750`)
- **n8n** : `https://n8n.srv1241880.hstgr.cloud` — instance partagée,
  **ne touche à aucun autre workflow**
- **Supabase** : projet `oymnthijjbwkatrhqzvi`

Je te donnerai les clés au moment voulu. Ne les écris jamais dans un fichier
ni dans le chat.

---

## PARTIE 1 — Google Cloud

Va sur `console.cloud.google.com`, connecté avec `agence.celexia@gmail.com`.

**Attention** : Google a changé cette console récemment. Selon la version, tu
verras soit l'ancienne interface (« Écran de consentement OAuth » avec des
étapes numérotées), soit la nouvelle (menu de gauche avec « Public cible »,
« Accès aux données », « Clients »). Adapte-toi à ce que tu vois, l'objectif
final est le même.

### 1.1 Créer le projet

- Sélecteur de projet en haut → **Nouveau projet**
- Nom : `CRM Celexia`
- Organisation : **Aucune organisation** (compte Gmail, pas Workspace)
- Créer, attendre, **puis bien sélectionner ce projet** dans le menu du haut

⚠️ Tout le reste doit se faire avec ce projet sélectionné. C'est l'erreur la
plus fréquente : activer l'API sur un autre projet.

### 1.2 Activer l'API

- **APIs et services → Bibliothèque**
- Chercher **« Local Services API »**
- ⚠️ **Ne prends pas « Google Ads API »**, c'est une autre API qui exige un
  developer token et une validation longue. Il faut bien **Local Services API**.
- **Activer**

### 1.3 Écran de consentement OAuth

- Type d'utilisateur : **Externe**
  (« Interne » est réservé aux comptes Workspace avec organisation)
- Nom de l'application : `CRM Celexia`
- E-mail d'assistance : `agence.celexia@gmail.com`
- Coordonnées du développeur : `agence.celexia@gmail.com`
- Domaine de l'application, page d'accueil, confidentialité : **laisser vide**,
  ce n'est pas obligatoire en mode test

### 1.4 Le scope — étape critique

Dans « Niveaux d'accès » / « Accès aux données » → **Ajouter ou supprimer des
niveaux d'accès**.

⚠️ Le scope nécessaire **n'apparaît pas dans la liste ni dans la recherche**.
Il faut descendre tout en bas du panneau, dans « Ajouter manuellement les
niveaux d'accès », et coller :

```
https://www.googleapis.com/auth/adwords
```

Puis : **Ajouter à la table** → **cocher la ligne** → **Mettre à jour** →
**Enregistrer**.

C'est bien le scope `adwords` même pour Local Services : il n'existe pas de
scope dédié. Il sera classé « sensible », c'est normal.

### 1.5 Utilisateur de test

Ajouter `agence.celexia@gmail.com` comme utilisateur test.

⚠️ **Ne clique JAMAIS sur « Publier l'application »**. En mode Test mes propres
comptes fonctionnent sans validation. Publier déclencherait une revue Google de
plusieurs semaines, pour rien.

### 1.6 Créer l'ID client OAuth

- **APIs et services → Identifiants → + Créer des identifiants → ID client OAuth**
- Type d'application : **Application Web**
- Nom : `n8n CRM`
- Origines JavaScript : **laisser vide**
- **URI de redirection autorisés** → ajouter **exactement** :

```
https://n8n.srv1241880.hstgr.cloud/rest/oauth2-credential/callback
```

⚠️ Au caractère près : `https`, pas de slash final, pas d'espace. Une erreur ici
provoque `redirect_uri_mismatch` au moment de connecter le compte.

- **Créer**

Garde l'**ID client** et le **code secret** affichés — ils servent tout de
suite. Ne me les écris pas dans le chat, garde-les pour l'étape suivante.

---

## PARTIE 2 — n8n

Va sur `https://n8n.srv1241880.hstgr.cloud`. Je te donnerai les identifiants.

⚠️ Cette instance héberge d'autres workflows, dont un qui envoie les mails de
mon CRM (« CRM Celexia — Notifications »). **N'y touche pas.**

### 2.1 Credential Google

**Credentials → New → Google OAuth2 API**

| Champ | Valeur |
|---|---|
| Client ID | celui de l'étape 1.6 |
| Client Secret | celui de l'étape 1.6 |
| Scope | `https://www.googleapis.com/auth/adwords` |

Puis **« Connect my account »** → me laisser me connecter avec
`agence.celexia@gmail.com` → accepter.

Google affichera un avertissement « Application non validée » : c'est normal en
mode Test. Cliquer sur « Paramètres avancés » puis « Accéder à CRM Celexia
(non sécurisé) ».

Nommer la credential : `Google LSA`.

### 2.2 Créer le workflow

Nouveau workflow, nommé **`LSA → CRM Celexia`**, avec quatre nœuds :

**Nœud 1 — Schedule Trigger**
- Toutes les **5 minutes**

**Nœud 2 — Code** (nommé `Période interrogée`)

```javascript
// Fenêtre glissante de 2 jours : assez large pour rattraper une panne n8n
// d'une nuit, assez étroite pour que la réponse reste légère. Les leads déjà
// vus sont écartés côté base, pas ici.
const fin = new Date()
const debut = new Date(Date.now() - 2 * 24 * 3600 * 1000)
return [{ json: {
  'startDate.year': debut.getFullYear(),
  'startDate.month': debut.getMonth() + 1,
  'startDate.day': debut.getDate(),
  'endDate.year': fin.getFullYear(),
  'endDate.month': fin.getMonth() + 1,
  'endDate.day': fin.getDate(),
} }]
```

**Nœud 3 — HTTP Request** (nommé `API Local Services`)
- Méthode : **GET**
- URL : `https://localservices.googleapis.com/v1/detailedLeadReports:search`
- Authentication : **Predefined Credential Type** → **Google OAuth2 API** →
  credential `Google LSA`
- **Send Query Parameters : activé**, avec sept paramètres :

| Nom | Valeur |
|---|---|
| `startDate.year` | `={{ $json['startDate.year'] }}` |
| `startDate.month` | `={{ $json['startDate.month'] }}` |
| `startDate.day` | `={{ $json['startDate.day'] }}` |
| `endDate.year` | `={{ $json['endDate.year'] }}` |
| `endDate.month` | `={{ $json['endDate.month'] }}` |
| `endDate.day` | `={{ $json['endDate.day'] }}` |
| `pageSize` | `100` |

**Nœud 4 — Code** (nommé `Leads → format CRM`)

Je te fournirai le fichier `lsa-api-vers-crm.code.js` à coller tel quel.

**Nœud 5 — HTTP Request** (nommé `Créer le lead`)
- Méthode : **POST**
- URL :
  `https://oymnthijjbwkatrhqzvi.supabase.co/rest/v1/rpc/ingerer_lead_externe`
- **Send Headers : activé**

| Nom | Valeur |
|---|---|
| `apikey` | *(la clé service_role que je te donnerai)* |
| `Authorization` | `Bearer <même clé>` |
| `Content-Type` | `application/json` |

- **Send Body : activé**, type **JSON**, contenu : `={{ JSON.stringify($json) }}`

Relier les nœuds dans l'ordre : Schedule → Période → API → Transformation →
Créer.

### 2.3 Tester AVANT d'activer

Lance le workflow à la main (**Execute Workflow**) et vérifie nœud par nœud :

1. **API Local Services** doit renvoyer un objet avec `detailedLeadReports`.
   - Erreur `401/403` → le scope ou la credential
   - Réponse vide → normal s'il n'y a eu aucun lead depuis 2 jours, élargis
     alors la fenêtre à 30 jours dans le nœud 2 pour tester
2. **Leads → format CRM** doit sortir des objets `{ p_lead: { telephone: "06…" } }`
3. **Créer le lead** doit répondre `{"ok": true, ...}`

Tu verras souvent `"cree": false, "raison": "telephone_deja_present"` — **c'est
le comportement attendu**, pas une erreur : le lead existe déjà dans mon CRM. Le
système est conçu pour être rejoué sans créer de doublons.

Une fois que ça marche, **activer** le workflow.

---

## Ce que je veux à la fin

Un compte-rendu qui me dit :

1. Si le workflow tourne et à quelle fréquence
2. Combien de leads ont été créés au premier passage, et combien étaient déjà
   connus
3. Ce que je dois surveiller les premiers jours
4. Ce qui reste manuel de mon côté

## Règles

- **Ne modifie aucun autre workflow n8n** — l'instance est partagée
- **N'écris aucune clé dans un fichier ni dans le chat**
- Si un écran ne correspond pas à ma description, **dis-le-moi et propose**
  plutôt que d'improviser : Google change souvent cette console
- Si l'API renvoie une erreur d'autorisation, **arrête-toi et explique** — c'est
  probablement le scope ou le lien entre le compte Google et le compte LSA
