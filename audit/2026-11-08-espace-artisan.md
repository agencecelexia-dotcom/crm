# Espace artisan — refonte du 8 novembre 2026

## Présentation

L’espace public `/artisan/:token` adopte le cadre visuel du CRM validé : navigation anthracite sur ordinateur, surfaces claires, typographie locale et accent violet réservé aux actions. Sur téléphone, une navigation fixe donne accès aux chantiers, devis et entreprise ; le menu regroupe les six rubriques. Chaque rubrique garde son URL et l’historique de navigation.

Les chantiers deviennent le centre de l’espace : quatre indicateurs regroupés, urgences compactes, analyses détaillées repliables, recherche et filtres visibles, liste alignée sur ordinateur et vue par étape. Une fiche s’ouvre désormais dans un panneau qui conserve la liste et la recherche derrière lui. Le suivi, les échanges, documents, dépôts PDF et archives partagent la même présentation.

Les devis disposent de filtres par état, d’une liste structurée et de messages distincts pour chargement, absence de devis, panne et attente de validation des assurances. Le générateur se présente en deux colonnes sur ordinateur, avec prestations à gauche et récapitulatif à droite ; ses actions restent visibles en bas sur téléphone.

Les commissions regroupent les totaux et le détail de calcul, les justificatifs et l’export CSV. La rubrique entreprise réunit contrat, identité et assurances, avec formulaires défilants et actions fixes. Les métrés et l’aide disposent de présentations dédiées. Le contrat initial sépare lecture et signature sans décoration concurrente du document.

Pour ouvrir facilement le portail depuis le CRM, un bouton **Ouvrir l’espace artisan** a été ajouté au bloc contrat de la fiche artisan, dans le périmètre de visibilité déjà autorisé pour le lien.

## Corrections liées aux parcours

- Le panneau ouvert reprend les données fraîches après une note de suivi, sans devoir le fermer puis le rouvrir.
- Le filtre « En cours » exclut les dossiers clos, notamment ceux déjà gagnés, au lieu de compter un devis signé comme un dossier encore à convertir.
- Les coordonnées client sont masquées avant signature, y compris pour la recherche ; devis, métrés et commissions ne montent pas leurs écrans tant que l’accès contractuel n’est pas ouvert. Le contrat signé hors application conserve son accès prévu.
- Les erreurs de devis, de vérification des assurances et de documents partagés proposent une nouvelle tentative et ne se présentent pas comme des listes vides.
- Les intitulés de montants, taux et étapes restent explicites. Les calculs comptables sont ceux des services existants ; le taux affiché conserve ses décimales.
- Les vues Liste / Par étape sont utilisables au clavier. Les petites cibles et les panneaux sont adaptés au mobile.

## Vérifications

- `npm run verify` : TypeScript, ESLint et build réussis. L’avertissement existant sur certains chunks de plus de 500 Ko subsiste.
- `npm run test:unit` : 558 réussis, 1 ignoré, dans 33 fichiers.
- `npm run test:interface` : **42 scénarios réussis en 38,8 secondes**, dont 24 sur le portail artisan et 18 sur le CRM principal.
- `git diff --check` : réussi. Revue visuelle finale des captures après correction du bandeau d’urgence et de l’identité d’entreprise sur petit écran.

La suite `tests/espace-artisan.spec.ts` utilise uniquement des identités et jetons fictifs, dans un navigateur dont toutes les API sont interceptées. Elle couvre les six vues, le retour URL, recherche et filtres, suivi en panneau, entreprise, assurances, relevé et export, erreurs réseau, confidentialité avant signature et ouverture/fermeture du générateur de devis. Les captures couvrent ordinateur, téléphone, six vues à 320 px et générateur à 375 × 600.

Captures : `test-results/artisan-review/`. Une barre fixe au milieu d’une capture pleine page représente le bas du viewport initial.

Les essais n’envoient aucun document réel et ne signent aucun contrat. Les moteurs cartographiques, IA et de calcul de métrés n’ont pas été remaniés. Aucun déploiement ni migration de données n’a été effectué.

La direction visuelle prolonge le travail fondé sur [unslop de Damir Sokolovsky (@heydamir)](https://github.com/heydamir/unslop), CC BY 4.0, adapté à la marque et aux parcours Celexia.
