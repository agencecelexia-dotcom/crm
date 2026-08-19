# Leads Google LSA → CRM

Chaque lead reçu sur Google Local Services Ads crée automatiquement une fiche
dans le pipe. Plus besoin de recopier les numéros à la main.

## Pourquoi passer par l'email

Google LSA **n'émet aucun webhook**. Deux voies existent :

| | Latence | Mise en place |
|---|---|---|
| Email de notification | ~1 min | rien à demander à Google |
| API `localservices.googleapis.com` | 5-15 min (interrogation) | projet Google Cloud, OAuth, accès à faire valider par Google |

L'email est retenu : il fonctionne aujourd'hui, sans validation préalable.
L'API reste possible plus tard si la fiabilité de l'email ne suffit pas — le
point d'entrée côté CRM ne changera pas.

## Le workflow à créer dans n8n

Trois nœuds, sur l'instance `n8n.srv1241880.hstgr.cloud`.

### 1. Gmail Trigger

- Credential : « Gmail account » (déjà configurée pour les notifications)
- **Filtre `Q`** : `from:(no-reply@localservices.google.com) is:unread`
  → à ajuster après avoir vérifié l'expéditeur réel de tes emails LSA
- Interrogation : toutes les minutes

### 2. Code

Coller le contenu de `lsa-vers-crm.code.js`.

Il extrait par **motifs** — un numéro français, un code postal — plutôt qu'en
suivant une structure HTML. Google remanie régulièrement ces emails ; un
analyseur calé sur leur mise en page casserait à la première refonte.

Testé sur trois formats, dont un dégradé sans étiquettes : le téléphone
ressort dans les trois cas.

### 3. HTTP Request

| Champ | Valeur |
|---|---|
| Méthode | `POST` |
| URL | `https://oymnthijjbwkatrhqzvi.supabase.co/rest/v1/rpc/ingerer_lead_externe` |
| Body | JSON, `{{ $json }}` |

En-têtes :

```
apikey:        <clé service_role>
Authorization: Bearer <clé service_role>
Content-Type:  application/json
```

La clé `service_role` se trouve dans Supabase → Project Settings → API.
Elle contourne toute la sécurité RLS : à ne jamais mettre ailleurs que dans
les credentials n8n.

## Ce qui protège des doublons

`ingerer_lead_externe` refuse silencieusement de créer deux fois le même lead :

1. **Référence identique** — même `source_ref`, la fiche existante est
   renvoyée. Un email rejoué ou un workflow relancé ne crée rien.
2. **Même numéro sous 30 jours** — repli quand Google ne fournit pas
   d'identifiant. Au-delà de 30 jours, un client qui recontacte est traité
   comme une nouvelle demande, ce qui est le comportement voulu.
3. **Ni téléphone ni nom** — la fiche serait inexploitable, la fonction
   répond `ni_telephone_ni_nom` sans rien créer.

La réponse indique toujours ce qui s'est passé :

```json
{"ok": true, "projet_id": "…", "cree": true}
{"ok": true, "projet_id": "…", "cree": false, "raison": "reference_deja_vue"}
```

## Ce que devient le lead

Statut **« nouveau »**, **sans artisan**. Il entre dans le flux normal de
qualification — l'attribution reste une décision humaine, comme pour
l'assistant d'appel.

La colonne `source` vaut `lsa` : de quoi mesurer, plus tard, ce que Local
Services rapporte réellement comparé aux autres canaux.

## Vérifier que ça marche

Après le premier lead :

```sql
select client_nom, client_telephone, client_ville, source_ref, created_at
  from projets where source = 'lsa' order by created_at desc limit 5;
```
