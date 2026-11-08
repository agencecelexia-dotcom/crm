# Métrés fiables et arrêt de chantier unifié — 8 novembre 2026

## Demande et constat

Le retour utilisateur porte sur des mesures fausses ou absentes et sur le doublon apparent entre « Pas de suite » et « Me retirer ». Le lot corrige les calculs, leurs sources, la restitution et les parcours de reprise. Il ne requalifie aucun historique de chantier.

## Corrections livrées par le code

| Défaut reproduit | Correction |
|---|---|
| Le serveur connaît le contour du chantier mais le chargement WFS du voisinage échoue : aucune maison n’est sélectionnée. | Le contour identifié reste sélectionné. Les métadonnées absentes restent absentes ; le voisinage peut être rechargé. |
| Après rechargement, le contour de secours et la feature WFS ont des identifiants différents. La maison peut devenir son propre voisin. | Identité comparée par `cleabs`, sélection enrichie sans changement de maison, exclusion du propre contour dans le calcul de mitoyenneté. |
| Une panne IGN est présentée comme une absence de bâtiment. | État de panne explicite, réessai et saisie terrain accessibles. |
| Une surface dessinée avec deux points est enregistrable comme longueur. | Trois points requis pour une surface ; le type choisi est conservé. |
| Valeurs déjà connues au dossier masquées faute de calcul local. | Résolution explicite entre valeur confirmée, calcul courant, estimation enregistrée et déclaration. Chaque origine reste indiquée. |
| Quantité globale confirmée appliquée à un versant partiel ou un autre bâtiment. | Portée chantier/sélection distincte dans les cartes, copies et exports. |
| `12abc` devient12 ; `1 200` devient1. | Lecture du nombre complet, formats français et unités contrôlés, erreurs conservant la saisie. |
| Pas de bâtiment identifié : aucune saisie manuelle. | Section « Mesures du chantier » indépendante du bâtiment et du LiDAR. |
| Sol absent remplacé par altitude0. | Un relevé sans sol exploitable échoue explicitement ; aucune altitude NGF ne devient une hauteur de façade. |
| TIFF incomplet, strips disjoints ou dimensions incohérentes acceptés. | Lecture des offsets/tailles, contrôles du format et des dimensions, exclusion des valeurs non finies. |
| Une photo d’une seule façade produit un total d’ouvertures de toute la maison. | Quantités globales seulement si toutes les façades concernées sont couvertes. La déduction issue de photos reste étiquetée IA. |
| Débord de40cm ajouté sans mesure au calcul de secours. | Calcul hors débord par défaut ; la valeur doit être mesurée ou renseignée. |
| Contour du navigateur enregistré sous un identifiant partagé sans vérification IGN. | La fonction toiture relit le contour canonique de cet identifiant avant calcul/cache. |
| Ancienne estimation conservée après disparition de sa source. | Après recalcul complet réussi, seuls les champs automatiques concernés sont invalidés ; valeurs humaines et dessins restent protégés. Une panne de lecture ne déclenche pas d’effacement. |
| Réponse métier refusée mémorisée comme succès et caches locaux insuffisamment distincts. | Refus explicite, cache par session et contour complet, attente bornée. |
| Fonctions inaccessibles sur le port local5174. | CORS commun pour les aperçus locaux et les origines déjà configurées. |
| Deux entrées concurrentes pour arrêter le suivi. | Une entrée « Ne pas poursuivre ce chantier », puis choix client/artisan et motifs appropriés, avec les gardes serveur existantes. |

Les versions du moteur passent à relevé8 et toiture4. Les anciennes versions deviennent recalculables lors des usages normaux ; aucune purge ni recalcul massif n’est exécuté pour l’audit. La précision théorique du bord n’est plus présentée comme une précision garantie de la mesure finale.

## Vérification

- Typecheck, lint et compilation de production réussis.
- Suite unitaire complète :719 tests réussis,1 cas historique ignoré car sa référence de toiture est absente.
-190 migrations chargées dans PostgreSQL local ;8 suites SQL réussies. Ce lot n’ajoute aucune migration.
- Les scénarios supplémentaires couvrent le WFS indisponible puis rétabli, les refus métier, la saisie sans bâtiment, les unités, les erreurs réseau, la sélection partielle, les TIFF invalides et la préservation des données humaines.
- Captures de la saisie terrain inspectées sur ordinateur et mobile ; contrôle de largeur à320px dans les parcours d’interface.
- Services publics vérifiés par21 requêtes gratuites bornées sur deux fixtures publiques : BAN, RNB, BD TOPO, COPC et modèles d’altitude. Une zone auparavant hors couverture dispose maintenant de LiDAR. Aucun relevé client, aucune analyse IA payante et aucun email déclenchés.
- Les sept fonctions serveur concernées ont été sauvegardées avant publication, dans un dossier privé hors dépôt. Les preuves de publication et la validation CI finale sont consignées dans la pull request.

La première passe des238 tests d’interface a été lancée alors que le nouveau scénario de retour WFS cherchait la hauteur dans l’onglet Toiture. Le test a été corrigé pour ouvrir Façades et vérifier l’absence de fausse mitoyenneté ; ses deux variantes passent. La CI finale rejoue l’ensemble du lot figé.

## Limites conservées

Les mesures à distance restent des estimations : disponibilité et date d’acquisition des sources, occultations et géométrie réelle peuvent imposer une vérification terrain. La conservation des valeurs humaines est intentionnelle. Les tests sur nuages figés vérifient le moteur ; ils ne certifient pas les dimensions de chaque chantier réel.

Les durées de réservation et d’expiration à version identique restent celles du serveur actuel, décrites dans [l’audit des sources](2026-11-08-metre-sources-reelles.md). Le bouton de réessai ne contourne pas ces protections. La relance datée après une perte client, autrefois mêlée à certains motifs de retrait, demanderait un parcours métier dédié ; la date de recontact reste disponible pour l’indisponibilité de planning de l’artisan.

Voir aussi [le suivi artisan](2026-11-08-artisan-suivi-audit.md), [les outils](2026-11-08-artisan-outils-audit.md) et [les calculs](2026-11-08-metre-fiabilite-calculs.md).
