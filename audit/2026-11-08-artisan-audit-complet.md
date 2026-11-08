# Espace artisan — audit complet et refonte des parcours

8 novembre 2026. Audit réalisé avant correction, puis scénarios rejoués après correction. Le périmètre couvre les six rubriques, leurs formulaires, les mutations serveur, les erreurs et la navigation sur ordinateur et mobile. Les rapports ci-dessous recensent aussi les fonctionnalités dont seul le code a été vérifié : aucune validation distante n’est déduite d’un mock réussi.

## Documents de référence

- [Suivi, statuts et chantiers](2026-11-08-artisan-suivi-audit.md) : 27 constats initiaux, preuves, corrections et cas restants.
- [Devis, documents, entreprise et assurances](2026-11-08-artisan-documents-audit.md) : inventaire complet, 22 constats, sauvegarde, calculs, envoi et accès.
- [Métrés, carte, photos, IA et 3D](2026-11-08-artisan-outils-audit.md) : inventaire des outils, erreurs, exports et limites de précision.
- [Activation du circuit d’envoi](2026-11-08-artisan-devis-deploiement.md) : ordre de déploiement, confirmation, déduplication et réconciliation.
- [Refonte visuelle précédente](2026-11-08-espace-artisan.md) : structure des six rubriques et vérification responsive.

## Diagnostic principal

L’espace avait un meilleur aspect mais plusieurs actions pouvaient donner un résultat trompeur : attente invisible, chantier signé rangé parmi les dossiers clos, brouillon recréé après une erreur, envoi annoncé avant sa prise en charge, suppression annoncée malgré un refus, export ignorant les corrections humaines. L’audit a donc porté sur ce que l’utilisateur comprend et sur ce que la base enregistre réellement.

La baseline existante passait **42 tests navigateur** et **558 tests unitaires**, avec un test ignoré. Les scénarios supplémentaires ont reproduit des erreurs qui n’étaient pas couvertes. Les rapports spécialisés conservent cette baseline ; les tests finaux n’utilisent plus de marqueurs d’échec attendu.

## Parcours désormais cohérents

| Parcours | Problème initial | Changement |
|---|---|---|
| Dossier reçu | Date du lead confondue avec date d’affectation | Chronologie et délais calculés depuis la réception par l’artisan |
| À traiter | Compteur et filtre ne montraient pas les mêmes dossiers | Une même sélection alimente l’alerte et sa destination |
| Statuts | « En cours » excluait des travaux signés ; signé présenté comme clos | « Avant signature », « Travaux à suivre », « Terminés ou perdus » ; « À contacter » dans le portail |
| Attente | Sous-statut en base invisible dans la fiche | Pause affichée, reprise explicite, étape conservée |
| RDV et rappels | Dates incohérentes, ancienne note indispensable pour voir le RDV | Date canonique, validation, erreurs récupérables, rappel distinct de l’avancement |
| Notes et appels | Double clic et texte effacé pendant un envoi | Verrou immédiat, texte conservé en erreur et nouvelle saisie préservée |
| Signature et recul | Conséquences financières insuffisamment expliquées | Confirmation et refus des reculs incompatibles avec une preuve signée ou une commission réglée |
| Perte, retrait, reprise | Restauration désaccordée avec l’étape conservée | Historique/devis conservés, dates périmées nettoyées, dates futures maintenues, refus métier explicites |
| Confidentialité | Archives/suivi insuffisamment protégés avant signature | Masquage UI et contrôles serveur ; accès aux pièces restreint à l’artisan et au chantier autorisés |
| Brouillon | Aucune vraie reprise, nouveaux numéros après panne | Réouverture du même devis, clé idempotente, protection des modifications |
| Déploiement progressif | Une ancienne API pouvait ignorer la clé de sauvegarde | Vérification des capacités avant toute création ; maintenance explicite et saisies conservées si le serveur est ancien ou indisponible |
| Deux onglets | PDF ancien potentiellement associé au montant nouveau | Révision obligatoire à l’édition, au rattachement PDF et à l’envoi |
| Prix et totaux | Deux arrondis, lignes sans intitulé, valeurs invalides | Arrondi commun par ligne/taux ; validation des lignes, prix, quantités, TVA et acompte |
| Suggestions IA | La réponse du modèle pouvait fournir directement un prix | Montants du modèle retirés ; prix rattachés en SQL aux catalogues autorisés, ouvrage et unité contrôlés |
| Envoi | HTTP opaque et statut « envoyé » prématuré | Réservation, consommation unique avant Gmail, accusé explicite, état incertain sans renvoi automatique |
| Entreprise | CGV remises à zéro sans demande, champs effacés conservés | Conservation/reset explicite des CGV, effacement effectif des champs facultatifs, caches actualisés |
| Assurances | Pannes et formats mal expliqués ; historique devis inaccessible | Formats/taille contrôlés, erreur et réessai ; historique lisible même si la création est bloquée |
| Dépôt PDF | Succès global malgré montant refusé ; montant extrait parfois invisible | Fichier reçu et montant enregistré distingués, reprise possible ; montant TTC extrait conservé dans le champ numérique |
| Commissions | Cellules textuelles pouvant devenir des formules | CSV neutralisé ; assiette, taux, justificatif et état de règlement conservés |
| Métrés | Panne assimilée à absence, suppression refusée annoncée réussie | États réseau et refus métier distincts, reprise locale |
| Mesure sur place | Plusieurs écritures pouvant réussir partiellement | Confirmation groupée transactionnelle avec contrôle d’accès |
| Exports métrés | Corrections humaines absentes du PDF/CSV/copie | Valeurs retenues, provenance, confiance et relevé initial exportés ensemble |
| Interface métrés | IA et réglages masquaient les valeurs utiles | Mesures visibles d’abord, IA dépliable, carte/3D et panneau côte à côte sur ordinateur |
| Photos personnelles | Accès insuffisamment lié au chantier et au déposant | Contrat/chantier vérifiés, photo personnelle réservée au déposant, voies indirectes contrôlées et caches séparés par jeton |
| Attente IA/LiDAR | Polling arrêté mais indicateur sans fin | Délai explicite, arrêt de l’attente, reprise de la lecture d’état sans relancer une analyse IA payante |

## Design et simplification

Le symbole du logo conserve son **violet**, y compris sur le fond sombre du menu. L’identité visuelle validée est conservée : navigation stable, titres lisibles, violet réservé aux repères utiles, surfaces et séparateurs sobres.

Les outils métier sont regroupés autour d’un même chantier. Le devis peut être créé dans l’espace ou déposé depuis un autre logiciel ; ce sont deux moyens d’alimenter le même suivi. La mise en attente et les rappels restent secondaires à l’étape, les travaux signés restent visibles, les estimations de métrés sont distinguées des quantités confirmées. L’aide explique ces différences et le blocage éventuel des assurances.

## Vérifications effectuées

- Parcours navigateur sur fixtures fictives : signature/refus/réessai, six vues, recherche/filtres/kanban, notes/appels/RDV/rappels, perte/retrait/restauration, devis/modèles/prix/entretien IA, PDF, uploads, entreprise/CGV/assurances, commissions, dessins de surface/longueur, corrections terrain, photos/ouvertures, progression IA, 3D, exports et retour navigateur.
- PostgreSQL local via PGlite : toutes les migrations du dépôt sont chargées. Auth, Storage, cron et HTTP sont remplacés par des stubs ; aucun service distant n’est invoqué. Les assertions vérifient les règles métier, les droits, les arrondis, les conflits de révision, le rollback et la prise unique d’un envoi.
- Huit fonctions de lecture du portail réel vérifiées : HTTP 200. Aucune modification de dossier, signature, pièce ou message réel n’a été effectuée.
- n8n : copie du workflow avec Gmail remplacé par un simulateur, authentification testée, accusé réussi, prise refusée et PDF invalide. Les copies temporaires ont été supprimées ; aucun email n’a été envoyé.
- TypeScript, ESLint, build et contrôle Deno des fonctions modifiées. CI enrichie avec les tests unitaires, SQL et parcours isolés.
- Export GLB réellement téléchargé sur ordinateur et mobile : signature `glTF`, version et longueur du fichier vérifiées.
- Lecture d’un vrai PDF natif par le worker PDF.js : bon TTC prérempli et sauvegardé ; document corrompu sans montant inventé.

Le contrôle des dépendances a révélé trois versions vulnérables : mises à jour ciblées vers PDF.js 6.2.108, Zod 4.6.7 et DOMPurify 3.4.17. L’audit des dépendances de production ne signale plus de vulnérabilité ; le seuil CI revient à `high`. Node minimal est aligné sur 22.13.0. Les runners CI utilisent explicitement Ubuntu 24.04, l’installation Chromium ayant échoué sur l’image 26.04 sélectionnée par `ubuntu-latest`.

Validation technique finale : **180 scénarios navigateur réussis**, **629 tests unitaires réussis, 1 ignoré**, **188 migrations chargées et 6 suites SQL réussies**, **9 tests du relais Deno réussis**, **4 scénarios n8n simulés vérifiés**. La passe finale navigateur dure 2,4 minutes ; TypeScript, ESLint et build passent. Le build conserve un avertissement non bloquant sur la taille de certains chunks chargés séparément, notamment la 3D.

Les captures sont conservées localement dans `test-results/artisan-review/` ; elles n’exposent que des données fictives et ne sont pas publiées dans Git.

## Limites à ne pas masquer

Les essais simulés ne prouvent ni la délivrabilité Gmail, ni la qualité des mesures IGN sur chaque bâtiment, ni l’exactitude des sorties IA. Aucun contrat réel n’a été signé et aucune API payante n’a été déclenchée pour l’audit. L’export PDF a été généré et son contenu vérifié ; une inspection exhaustive de chaque mise en page et de tous les cas de texte très long reste distincte de ces tests.

Le carnet de tracés ne propose pas encore une réédition complète ni un transfert automatique de toutes les quantités dans les lignes de devis. La qualification des pertes reste à unifier entre certains parcours. Les notes/appels sont protégés contre les soumissions concurrentes dans l’interface, mais ne possèdent pas encore de clé idempotente persistante en cas de réponse réseau perdue. Les envois incertains nécessitent une réconciliation par l’agence ; aucun déblocage automatique ne doit provoquer un second email.

## Publication

L’accès administrateur au projet existant a été rétabli pendant la publication. Les migrations **0184–0188 ont été appliquées ensemble, dans une transaction**, après sauvegarde locale des définitions SQL et des bundles serveur précédents. Aucun montant historique n’a été recalculé ; les comptages artisans, projets, affectations, devis et suivis sont inchangés après déploiement.

La cible a été recoupée avec le bundle du site public `crm-ci7k.vercel.app` : il utilise bien la même base que la configuration locale. Changer l’URL vers un autre projet accessible ne constituerait pas une publication sur la base actuelle.

Les quatre fonctions `devis-envoyer`, `document-signe`, `devis-suggerer` et `facade-photo` sont déployées. Les secrets du relais ont été configurés et le workflow n8n dédié est **activé** ; le workflow générique précédent est conservé. Vingt contrôles distants ont vérifié les CORS, refus de jetons fictifs, callback authentifié sur une clé inexistante, six lectures du portail réel, protocole devis 2, permissions SQL et comptages. Le webhook actif refuse une requête non authentifiée et n’accuse pas un PDF invalide. Aucun email réel n’a été envoyé.

L’interface et les rapports sont versionnés dans la [PR 83](https://github.com/agencecelexia-dotcom/crm/pull/83), avec les contrôles GitHub et les déploiements Vercel associés. Les anciens onglets doivent être rechargés après publication : les appels PDF et d’envoi utilisent désormais le nouveau protocole serveur.
