# Activation du devis fiable

Le frontend sauvegarde et télécharge indépendamment de la disponibilité de la messagerie. La nouvelle action « Au client » passe par `devis-envoyer`. Un service absent ou une réponse ambiguë ne produit jamais un succès affiché. Aucun email réel n’a été envoyé pendant la préparation.

## Livrables

- Migrations `0185_devis_brouillons_envoi_fiable.sql` et `0187_devis_envoi_prise_unique.sql` : clé idempotente, brouillon reprenable, révision vérifiée à l’édition/PDF/envoi, arrondis communs, consommation unique avant messagerie, confirmation et verrou des devis envoyés.
- Edge `supabase/functions/devis-envoyer/index.ts` et helper `_envoi-devis.ts` : droits serveur, destinataire issu du devis sauvegardé, téléchargement limité à 10 Mo depuis le bucket Supabase attendu, délais bornés, statut confirmé seulement après accusé explicite.
- Edge `document-signe` : contrôle artisan actif, projet non supprimé et contrat signé/externe.
- Workflow n8n importable **désactivé** : `automation/n8n/devis-envoi-confirme.template.json`. Aucun secret ni adresse réelle dans le fichier. Il nécessite les credentials de l’environnement avant activation.

## Ordre d’activation

1. Exécuter `npm run test:sql`, puis appliquer toutes les nouvelles migrations de ce lot avant l’endpoint et l’interface. **0185 utilise une colonne ajoutée en 0187 : les deux doivent être présentes avant tout envoi.** Les montants historiques ne sont pas recalculés.
2. Importer le workflow désactivé dans n8n. Associer « Remettre à Gmail » au credential Gmail déjà utilisé par le workflow actuel, sans copier de secret. Le template versionné contient un placeholder ; le workflow préparé dans l’instance possède la référence existante. Le compte authentifié définit l’expéditeur.
3. Sur « Recevoir le devis » et « Réserver la remise unique », configurer le même credential Header Auth : nom `Authorization`, valeur `Bearer <secret dédié>`. Le second nœud appelle `/functions/v1/devis-envoyer` sur le projet cible avec l’action `prendre_envoi`. La clé est consommée atomiquement en base ; tout refus interrompt le workflow avant Gmail. Publier uniquement après vérification des credentials, du chemin distinct `celexia-devis-confirme-v1` et du nœud de réponse placé **après** le succès Gmail. L’ancien webhook générique n’est pas modifié par cet export.
4. Configurer dans les secrets Supabase `DEVIS_EMAIL_WEBHOOK_URL` = URL de production de ce webhook et `DEVIS_EMAIL_WEBHOOK_SECRET` = le même secret dédié. Les clés Supabase service role/URL sont injectées par le runtime, jamais dans le frontend.
5. Déployer `devis-envoyer` en accès public sans contrôle JWT Supabase utilisateur (`verify_jwt=false`) : l’action utilisateur vérifie le jeton artisan et la révision via les RPC ; le callback interne exige le secret partagé. Le workflow ne reçoit aucune clé Supabase service role. Déployer également `document-signe`, `devis-suggerer` et `facade-photo` après leurs migrations d’accès.
6. Déployer le frontend après la migration ; le frontend précédent appelle directement la RPC de marquage, désormais réservée au service role. Prévoir donc cette courte coordination lors de la mise en production.

## Contrat HTTP explicite

Le navigateur fournit `{token, devis_id, revision}`. Le relais charge le destinataire et le document sauvegardés puis transmet le format historique (`event`, `email`, `numero`, `filename`, `subject`, `html`, `pdf_base64`) avec une `idempotency_key` générée en base pour la tentative. La réponse de succès doit être un HTTP 2xx contenant exactement ces garanties :

```json
{"ok":true,"accepted":true,"idempotency_key":"la-même-clé-que-la-requête"}
```

La réponse est produite après l’acceptation par Gmail. Elle prouve cette prise en charge, pas la réception finale, l’absence de spam, ni la lecture du message. HTTP 200 seul, réponse « Workflow started », absence d’identifiant ou mauvais identifiant sont refusés. Les modes de réponse webhook et les pièces jointes Gmail correspondent à la [documentation Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), à [Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/) et aux [opérations Gmail](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/).

## Idempotence et résultat ambigu

La réservation en base prend un verrou sur le devis. Une seconde requête pendant l’envoi, ou après résultat ambigu, ne contacte pas le webhook. Une requête répétée après confirmation renvoie « déjà envoyé ». Le workflow fourni n’effectue pas de relance automatique du nœud Gmail ; ne pas ajouter de retry ni relancer manuellement une exécution sans vérifier sa remise effective.

Si le téléchargement du PDF échoue **avant** la requête mail, état `echec` : l’utilisateur peut réessayer. Dès qu’une requête mail a pu partir, timeout/refus/réponse invalide deviennent `incertain`. Le brouillon est conservé mais édition/envoi bloqués jusqu’à vérification humaine. Un crash laisse `en_cours`, également bloqué. Il ne faut pas expirer ce verrou automatiquement : un email peut avoir été envoyé alors que son accusé s’est perdu.

Une réconciliation doit vérifier l’exécution n8n et l’acceptation Gmail de cette clé, puis finaliser `confirme` si l’envoi est établi, ou libérer `echec` seulement si son absence est établie. L’interface de réconciliation agence n’est pas ajoutée dans ce lot ; les RPC de finalisation sont accessibles uniquement au service role. La prise SQL avant Gmail empêche le rejeu de la même clé depuis l’entrée du workflow. Ne pas exécuter manuellement le nœud Gmail isolé : cela court-circuiterait les gardes du parcours.

## Vérifications et limites de publication

- Les suites UI et unitaires utilisent des réponses fictives. Toutes les migrations et les assertions sont exécutées dans PostgreSQL local via PGlite, avec les services Supabase/HTTP simulés.
- Neuf tests Deno exercent le handler serveur : révision transmise, ordre réservation/PDF/mail/confirmation, résultat ambigu, PDF externe ou invalide, rejeu, conflit et secret du callback. Aucune permission réseau n’est accordée à ces tests.
- Après renouvellement de l’accès n8n, le workflow de production a été importé **désactivé**, puis activé après déploiement et vérification du serveur. Ses deux nœuds utilisent le credential Header Auth dédié. Le credential Gmail reste celui de l’instance existante ; le webhook générique n’a pas été modifié.
- Une copie isolée a été exécutée dans l’instance n8n : Gmail remplacé par un Code node sans messagerie, callback de prise remplacé par une réponse fictive. Quatre cas ont été vérifiés : absence d’authentification refusée HTTP403, prise confirmée avec accusé explicite, prise refusée sans accusé, PDF invalide sans accusé. Les workflows temporaires ont été désactivés puis supprimés. Aucun email envoyé.
- n8n peut répondre HTTP200 avec un corps vide après une erreur de workflow. Le relais refuse cette réponse : le statut HTTP ne suffit jamais à marquer le devis envoyé.

La configuration du relais est conservée dans `.env.secrets.local`, ignoré par Git : `DEVIS_EMAIL_WEBHOOK_URL`, `DEVIS_EMAIL_WEBHOOK_SECRET` et `DEVIS_EMAIL_WORKFLOW_ID`. Le secret doit être enregistré dans le projet Supabase cible avant activation.

**Publication serveur du 8 novembre 2026 :** l’accès administrateur au bon projet a été rétabli. Les migrations 0184–0188 ont été appliquées dans une transaction ; les quatre fonctions et les deux secrets du relais sont déployés. Les contrôles distants ont confirmé les permissions, le protocole devis 2 et les lectures du portail. Le workflow n8n est activé ; ses refus sans authentification et sur PDF invalide ont été vérifiés. Les comptages métier sont inchangés. La délivrabilité Gmail, l’accusé réel du fournisseur et les autres services externes ne sont pas annoncés comme testés : aucun email réel n’a été envoyé.

## Coexistence temporaire avec un ancien backend

Avant d’appeler la création, le frontend lit `capacites_devis_by_token` (migration 0185) et exige le protocole 2 avec idempotence et révisions. Si cette fonction est absente, incompatible ou inaccessible, la sauvegarde s’arrête avant toute réservation de numéro : message de maintenance, saisies conservées, aucune ancienne RPC de création appelée. L’aperçu et les documents historiques restent accessibles. Cette protection permet de publier une prévisualisation sans générer de doublons pendant que les migrations attendent leur déploiement ; elle ne rend pas les nouvelles fonctions disponibles sur un backend ancien.
