# Leads Google LSA → CRM

Chaque lead Local Services crée automatiquement une fiche dans le pipe, avec
le numéro de téléphone. Plus de ressaisie.

## Pourquoi l'API et pas l'email

L'email de notification LSA **ne contient aucun numéro** :

> « Un client potentiel vous a appelé le 19/08/2026 à 09:52. Voir les détails »

Rien d'exploitable. Le numéro n'existe que dans le tableau du site LSA — et
dans l'API, qui expose ce même tableau.

Vérifié sur le document de découverte de `localservices.googleapis.com` :
`detailedLeadReports.search` renvoie `phoneLead.consumerPhoneNumber` et
`messageLead.consumerPhoneNumber`, plus `leadId`, `geo`, `leadCategory`,
`leadPrice`, `chargeStatus`.

Contrairement à l'API Google Ads, celle-ci **ne demande aucun developer token
ni validation Google** : un simple OAuth sur ton propre compte suffit.

---

## Étape 1 — Google Cloud (~20 min, une seule fois)

1. **console.cloud.google.com** → créer un projet, ex. « CRM Celexia »
2. **APIs & Services → Library** → chercher « Local Services API » → **Enable**
3. **APIs & Services → OAuth consent screen**
   - Type : **External**
   - Renseigner nom d'app et email de contact
   - **Scopes** : ajouter `https://www.googleapis.com/auth/adwords`
   - **Test users** : ajouter `agence.celexia@gmail.com`
     → inutile de publier l'app : en mode test, tes propres comptes marchent
4. **APIs & Services → Credentials → Create → OAuth client ID**
   - Type : **Web application**
   - **Authorized redirect URI** :
     `https://n8n.srv1241880.hstgr.cloud/rest/oauth2-credential/callback`
   - Noter le **Client ID** et le **Client Secret**

## Étape 2 — Credential n8n (~5 min)

Dans n8n → **Credentials → New → Google OAuth2 API**

| Champ | Valeur |
|---|---|
| Client ID | celui de l'étape 1 |
| Client Secret | celui de l'étape 1 |
| Scope | `https://www.googleapis.com/auth/adwords` |

Cliquer **Connect my account**, se connecter avec le compte Google qui gère
le compte LSA (numéro client `139-304-5750`).

## Étape 3 — Le workflow (~10 min)

Importer `lsa-api-workflow.json` (n8n → Workflows → Import from File), puis :

1. **Nœud « API Local Services »** → choisir la credential de l'étape 2
2. **Nœud « Leads → format CRM »** → coller le contenu de
   `lsa-api-vers-crm.code.js` (le fichier importé ne contient qu'un
   marqueur)
3. **Nœud « Créer le lead »** → remplacer `{{ $env.SUPABASE_SERVICE_KEY }}`
   par la clé `service_role` (Supabase → Project Settings → API), ou
   définir cette variable d'environnement dans n8n

Activer le workflow.

---

## Comment ça tourne

```
Toutes les 5 min
  ↓  fenêtre glissante de 2 jours
API detailedLeadReports.search
  ↓  leadId, consumerPhoneNumber, geo, leadCategory
Transformation → format CRM
  ↓
ingerer_lead_externe  (déjà en place côté base)
  ↓
Fiche « nouveau », sans artisan
```

**La fenêtre de 2 jours est volontaire** : elle rattrape une panne n8n d'une
nuit sans intervention. Les leads déjà connus sont écartés par la base, pas
par n8n.

## Ce qui empêche les doublons

Interroger toutes les 5 minutes rejoue forcément les mêmes leads. Trois
protections dans `ingerer_lead_externe`, testées :

1. **`leadId` déjà vu** → renvoie la fiche existante, ne crée rien
2. **Même numéro sous 30 jours** → idem. Testé sur un vrai lead du 19/08 :
   le numéro existait déjà dans le CRM, aucune fiche créée
3. **Sans numéro** → écarté avant même d'atteindre la base

La réponse dit toujours ce qui s'est passé :

```json
{"ok": true, "projet_id": "…", "cree": true}
{"ok": true, "projet_id": "…", "cree": false, "raison": "reference_deja_vue"}
```

## Ce que devient le lead

Statut **« nouveau »**, **sans artisan** — l'attribution reste une décision
humaine, comme pour l'assistant d'appel.

`source = 'lsa'` permettra de mesurer ce que Local Services rapporte comparé
aux autres canaux. `leadPrice` et `chargeStatus` sont conservés dans la
description : de quoi rapprocher un jour le coût d'acquisition du chiffre
réellement signé.

**LSA ne transmet pas la nature des travaux** — seulement une catégorie large
(`roofer`, `siding`…). La description le signale : « À QUALIFIER ».

## Vérifier

```sql
select client_nom, client_telephone, client_ville, metier, source_ref, created_at
  from projets where source = 'lsa' order by created_at desc limit 10;
```
