# Audit de fiabilité du CRM — 7 novembre 2026

## Périmètre et limites

Revue des sources React, des hooks de données, de l'authentification, des parcours projets/artisans/commissions/tâches, de migrations SQL représentatives et des tests. Les constats décrivent le code du dépôt, pas une inspection exhaustive de la base déployée. Aucun compte réel, jeton privé, service payant, envoi, modification de production ou migration n'a été utilisé. Les règles financières SQL restent inchangées.

La revue visuelle et de navigation est couverte par le rapport principal. Ce document détaille les problèmes de fiabilité et les corrections associées. Les références de lignes correspondent à l'état du code pendant cette intervention.

## Corrections réalisées

| Priorité | Constat et conséquence | Correction et références |
| --- | --- | --- |
| P1 | Le cache React Query était partagé entre les connexions successives, avec des clés indépendantes de l'utilisateur. La fiche membre précédente restait également en mémoire. Un changement de compte pouvait donc afficher des données ou droits obsolètes. | Purge synchrone des requêtes et mutations au changement d'identité, sans purger lors d'un renouvellement du jeton. La fiche chargée est liée à son utilisateur ; une autre session ne peut pas la récupérer. `src/lib/auth/auth-provider.tsx:45`, `src/lib/auth/isolation-session.ts:10`. |
| P1 | La carte des montants était remontée à chaque changement de `updated_at` : une actualisation serveur effaçait les saisies non enregistrées. Son ancienne comparaison de valeurs locales avec les nouvelles props aurait aussi envoyé des champs obsolètes sans ce remontage. | Brouillon contenant seulement les champs explicitement modifiés. Les champs intacts suivent le serveur, les signatures reçues restent intactes lors d'une modification de l'estimation. La clé devient l'ID du projet uniquement. `src/features/projets/components/montants-card.tsx:25`, `src/features/projets/lib/montants-form.ts:20`, `src/features/projets/pages/projet-detail-page.tsx:351`. |
| P1 | La page Commissions attendait seulement la liste des projets. Une RPC `commissions_dues` lente ou en erreur affichait « toutes encaissées » et un total nul. | Les deux requêtes doivent avoir réussi avant d'afficher le total ou l'état vide. Une erreur affiche un message et une action Réessayer. `src/features/commissions/commissions-page.tsx:39`. |
| P1 | Un projet absent, interdit ou en erreur réseau restait indéfiniment sous forme de skeleton. | État explicite « Projet indisponible », nouvel essai et retour à la liste. Le message ne prétend pas distinguer une absence d'un refus RLS. `src/features/projets/pages/projet-detail-page.tsx:91`. |
| P2 | Les mutations projets rafraîchissaient seulement les requêtes `projets`. Les compteurs d'affectations, soldes, indicateurs et actions pouvaient rester obsolètes après un changement. | Invalidation commune des données dérivées : projets, affectations, indicateurs, commissions, actions, reprises et tâches. Les requêtes actives se rafraîchissent ; les autres sont marquées périmées. `src/features/projets/lib/invalidation.ts:5`, `src/features/projets/hooks/use-projets.ts:134`. |
| P2 | Les affectations utilisaient plusieurs appels, dont les erreurs de lecture ou mise à jour secondaire étaient ignorées : l'interface pouvait annoncer un succès incomplet. | Contrôle des erreurs de chaque appel et actualisation après succès ou échec partiel, y compris des compteurs d'affectation. L'atomicité côté serveur reste à traiter. `src/features/projets/hooks/use-affectations.ts:83`, `:118`, `:156`. |
| P2 | Le taux 12,5 % était présenté comme 13 %, et le libellé du montant de commission pouvait suivre un taux saisi mais non enregistré. | Affichage du taux avec ses décimales et libellé de commission lié au taux enregistré. Aucun changement du calcul SQL. `src/features/projets/lib/montants-form.ts:8`, `src/features/projets/components/montants-card.tsx:178`. |

La revue des pages de création a également relevé des formulaires accessibles avant vérification des droits. Les gardes de création ont été ajoutées dans le chantier principal : `src/features/projets/pages/projet-new-page.tsx:15` et `src/features/artisans/pages/artisan-new-page.tsx:13`.

## Points restant à traiter

| Priorité | Problème et référence | Suite recommandée |
| --- | --- | --- |
| P2 | Affectations non transactionnelles : un ajout/retrait peut réussir puis la mise à jour du projet échouer. `src/features/projets/hooks/use-affectations.ts:67`. | Déplacer l'ensemble dans une RPC transactionnelle, avec tests de concurrence et règles de conservation de l'historique. La correction actuelle révèle l'échec et rafraîchit les données mais ne l'annule pas. |
| P2 | Le géocodage n'a pas de délai maximal (`src/lib/geocoding.ts:83`) et précède la sauvegarde des projets et artisans. Une requête bloquée retient la file entière. Une modification regéocode aussi lorsque l'adresse n'a pas changé. | Borner le délai, préserver les coordonnées existantes si l'adresse est inchangée et distinguer adresse introuvable d'erreur temporaire. Envisager un enrichissement après sauvegarde. |
| P2 | Listes projets/artisans/affectations/tâches sans pagination : `src/features/projets/hooks/use-projets.ts:17`, `src/features/artisans/hooks/use-artisans.ts:27`, `src/features/projets/hooks/use-affectations.ts:49`. | Pagination côté serveur, recherche filtrée, agrégats dédiés pour les totaux. Risque de troncature à la limite API ; le seuil et le volume effectifs de production n'ont pas été vérifiés. |
| P2 | La régénération des tâches ignore son erreur : `src/features/taches/use-taches.ts:34`. L'erreur de régénération reste invisible même si la lecture de la liste réussit ; l'interface tâches gère désormais les erreurs de lecture. | Contrôler l'erreur RPC, afficher clairement un échec de synchronisation et permettre un nouvel essai. |
| P2 | La nouvelle invalidation couvre les hooks projets/affectations. D'autres chemins, par exemple l'encaissement direct depuis les tâches (`src/features/taches/use-taches.ts:127`), conservent leur invalidation locale. | Réutiliser progressivement l'invalidation commune pour les mutations restantes, sans rafraîchir inutilement toutes les données. |
| P2 | Une sauvegarde explicite du même champ par deux personnes reste un scénario de dernière écriture gagnante. | Si le travail simultané devient fréquent, ajouter une détection de version/conflit côté serveur. Le brouillon actuel préserve les champs intacts mais ne constitue pas un verrou transactionnel. |
| P3 | Le README décrit encore une affectation unique, deux comptes sans rôles et les quatre premières migrations, alors que l'application gère plusieurs artisans et une équipe. `README.md:8`, sections Supabase et structure. | Réécrire le guide avec le modèle et les procédures actuels ; préciser les termes lead/projet/chantier, affectation et commission. |
| P2 | Les anciens E2E couvraient surtout les accès non authentifiés. La nouvelle suite isolée couvre navigation, droits et filtres ; les signatures/encaissements complets restent à couvrir. `tests/connexion.spec.ts` le signale explicitement. | Compléter les fixtures authentifiées avec affectation, signature, encaissement et changement de compte de bout en bout. Ne pas les exécuter contre les dossiers réels. |

## Éléments solides

- Les indicateurs monétaires et commissions dues s'appuient déjà sur des RPC métier plutôt que sur plusieurs calculs concurrents dans le navigateur.
- Des politiques RLS, gardes de routes fondateur et protections des jetons d'espace artisan sont présentes dans les sources.
- Les pages publiques de signature et d'espace artisan possèdent des frontières d'erreur.
- Les tests unitaires existants couvrent largement les calculs de devis et de métrés.

Ces points sont des observations de code ; ils ne valent pas certification des politiques réellement déployées.

## Validation des corrections de fiabilité

- 14 tests ciblés passent : isolation de compte (5), sauvegarde des montants (4), invalidation métier (1), rendu des commissions en attente/erreur/vide (4).
- Tests : `tests/unit/auth-isolation.test.ts`, `tests/unit/montants-form.test.ts`, `tests/unit/projets-invalidation.test.ts`, `tests/unit/commissions-etats.test.tsx`.
- ESLint passe sur les fichiers de ce chantier ; `npx tsc -b --noEmit` passe.
- Les vérifications utilisent un QueryClient local, des fonctions pures et un rendu serveur simulé. Aucun appel métier de production n'a été effectué.
- Les vérifications globales du build, des autres tests et de l'interface figurent dans le bilan du chantier principal.
