# Workflow n8n — Notifications & emails CRM Celexia

Workflow `PkhPQia4Ci2wwsCn` « CRM Celexia — Notifications » sur
https://n8n.srv1241880.hstgr.cloud (instance partagée — ne pas toucher aux autres workflows).

Webhook public : `POST /webhook/crm-celexia-events`
Nœuds : Webhook → **Code** (`crm-celexia-events.code.js`) → Gmail (credential « Gmail account »).

Événements gérés (champ `event` du body JSON) :
- `contrat_signe` / `devis_depose` → email à agence.celexia@gmail.com (notif interne)
- `envoyer_lien_mission` → email à l'ARTISAN (champ `email`) avec le lien de mission

Important : le Code parse le corps même reçu en `text/plain` (le front l'envoie en
`no-cors`, ce qui force text/plain). Déclenché aussi par triggers Supabase pg_net
(contrat signé / devis déposé) — voir migration 0009.

## Invitations d’inscription par Gmail

`invitations-artisans.workflow.json` décrit un workflow distinct des notifications.
Le formulaire agence appelle l’Edge Function `invitation-artisan` avec sa session.
Elle vérifie le membre et son droit de création d’artisans, construit le HTML,
et réserve un identifiant dans `invitations_artisans` (migration 0193).
Le taux est toujours explicite dans `/rejoindre/email?taux=10|15|20`.

Pour importer le modèle, remplacer `__EDGE_URL__`, `__HEADER_CREDENTIAL_ID__`
et les deux références Gmail par les credentials de l’instance. Le credential
Header Auth contient `Authorization: Bearer <secret du relais>`. Configurer côté
Edge `INSCRIPTION_EMAIL_WEBHOOK_URL` et `INSCRIPTION_EMAIL_WEBHOOK_SECRET` ;
aucun de ces secrets ne va dans le navigateur ou dans Git. Le `webhookId` doit
être présent avant activation du workflow.

Avant Gmail, le callback privé `prendre` fait passer atomiquement la demande de
`reserve` à `en_cours`. Après Gmail, `confirmer` enregistre son identifiant de
message. Une réponse HTTP réussie ne suffit pas à afficher « Envoyée » : la
confirmation doit aussi exister dans le journal. Après un délai ou une réponse
ambiguë, l’état est `incertain` : vérifier Gmail et l’exécution n8n avant toute
nouvelle invitation. Ne pas ajouter de retry automatique au nœud Gmail.

Le test du relais se fait sur une copie temporaire dont le nœud Gmail est
remplacé par un simulateur, avec une adresse `example.test`. Ne jamais exécuter
un test de transport avec des données client. La validation des noms facultatifs,
du HTML échappé et des liens 10/15/20 % est couverte par les tests unitaires.
