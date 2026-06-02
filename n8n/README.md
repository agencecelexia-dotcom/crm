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
