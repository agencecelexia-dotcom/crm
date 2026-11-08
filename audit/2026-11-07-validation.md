# Validation — 7 novembre 2026

## Vérifications globales

- `npm run verify` : **réussi** (TypeScript, ESLint, compilation de production).
- `npm run test:unit` : **558 tests réussis**, 1 ignoré, dans 33 fichiers.
- `git diff --check` : **réussi**.

Les nouveaux tests unitaires couvrent l'isolation des comptes, la conservation des champs financiers non modifiés, les états de commissions, l'invalidation des données dérivées et les droits de navigation.

## Interface isolée

Commande reproductible : `npm run test:interface`.

La configuration `tests/interface.config.ts` lance un serveur local sur le port 5180, avec URL et clé publiques fictives. Le helper `tests/helpers/interface-backend.ts` intercepte les API. Aucun compte ni dossier réel n'est nécessaire ; les requêtes non simulées sont bloquées. La suite comporte des variantes Chromium ordinateur et Pixel 7, avec vérifications à 320 px et en modale 375 × 600.

Scénarios couverts :

1. Navigation complète, accès mobile aux modules, fermeture du menu et rubrique active dans les sous-pages.
2. Visibilité des modules et actions selon le rôle commercial/fondateur.
3. Filtres artisans conservés après retour et réinitialisables.
4. Distinction échec réseau / liste vide.
5. Retour vers la destination et les filtres demandés après connexion.
6. Absence de débordement horizontal sur listes et tableau de bord.
7. Refus de l'accès direct à la prise d'appel et à la création sans droits, sans démarrage de transcription.
8. Modale courte utilisable au clavier : action accessible, une seule soumission simulée et conservation de la saisie après erreur.

**Résultat final : 18 tests sur 18 réussis en 16,6 secondes**, avec `npm run test:interface`. Les contrôles de droits et de modale sont inclus sur les deux formats.

## Revue visuelle

Captures locales dans `test-results/review/` : connexion, projets, artisans et tableau de bord, ordinateur et mobile ; liste projets à 320 px. Les captures ont été inspectées, y compris `nouveau-projet-375-mobile.png` pour vérifier les bornes et le défilement de la modale. La revue a notamment conduit à empiler les filtres sous 360 px et à éviter le bouton de développement qui recouvrait le menu.

Limites : le navigateur intégré de l'application n'était pas disponible. La revue utilise Chromium via la suite Playwright du projet. Les fontes CDN sont bloquées par l'isolation réseau : les captures montrent les polices de repli ; l'application conserve ses polices de marque. Une barre fixe visible au milieu d'une capture pleine page correspond au bas du viewport initial, pas à sa position dans le document déroulé.

Les écrans et services métier réels (signature, paiement, email, IA, géodonnées) n'ont pas été exercés sur la production. Les anciens E2E publics ne remplacent pas cette nouvelle suite authentifiée isolée et n'ont pas été relancés dans cette intervention.

## Performance mesurée au build

| Fichier applicatif principal | Avant découpage des routes | Après découpage |
| --- | ---: | ---: |
| JavaScript minifié | 1 118,54 Ko | 513,75 Ko |
| Compressé gzip | 334,57 Ko | 160,67 Ko |

Réduction d'environ 54 % du fichier principal. Il s'agit d'une comparaison de sorties de build pendant cette intervention, pas d'une mesure de la totalité des téléchargements, du temps de démarrage ou d'un score Lighthouse.

Le build reste accompagné d'un avertissement de taille pour certains chunks, dont la vue 3D (~612 Ko minifiés, chargée à la demande) et le principal (~514 Ko). Le worker PDF et les bibliothèques spécialisées restent volumineux. Le budget de performance de ces écrans mérite un chantier dédié.

## Livraison

Modifications présentes dans le dépôt local ; aucune migration SQL, publication, opération de production ni nouveau service externe. Aucun changement de dépendance requis. Les captures et résultats de test sont des artefacts locaux ignorés par Git ; les rapports et tests sont dans les sources.
