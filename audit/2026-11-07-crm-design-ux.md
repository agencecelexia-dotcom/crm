# CRM Celexia — audit produit, UX, design et fiabilité

Date : 7 novembre 2026. Travail réalisé sur le dépôt local, sans déploiement.

## Conclusion

Le CRM dispose d'une base métier riche et utile, mais son interface s'est construite par ajouts successifs. Son principal problème était la difficulté à savoir **quoi faire, sur quel périmètre et avec quel niveau de confiance dans les chiffres**. Le style très coloré accentuait ce manque de hiérarchie.

L'intervention porte sur le socle visuel partagé, la navigation, l'accueil, les listes projets/artisans, la connexion, les états dégradés et plusieurs défauts de fiabilité. Elle conserve les outils spécialisés, la marque et les règles métier de la base.

Ce document ne présente pas tous les problèmes comme résolus. Les limites de la revue et les suites prioritaires figurent ci-dessous. L'[audit de fiabilité](2026-11-07-fiabilite.md) détaille les corrections de données et leurs tests.

## Méthode et périmètre

- Inventaire d'une application comportant 283 fichiers source, 183 migrations et 60 fichiers de fonctions Supabase au début de la revue.
- Lecture de l'architecture, routes, authentification, composants communs, hooks et parcours principaux ; revue ciblée des règles SQL qui alimentent les indicateurs.
- Audits parallèles de l'expérience utilisateur et de la fiabilité, puis revue croisée des modifications.
- Vérifications TypeScript, ESLint, compilation, tests unitaires métier et nouveaux scénarios d'interface sur backend simulé.
- Pas d'audit de la base de production, de certification de sécurité ou de vérification en conditions réelles des emails, signatures, paiements, webhooks, IA et sources géographiques. Aucun dossier réel modifié.

### Référence de design

Méthode **[unslop](https://github.com/heydamir/unslop)**, créée par **Damir Sokolovsky / [@heydamir](https://x.com/heydamir)**, sous licence **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. Le skill et ses références `signs.md` et `tokens.md` ont été consultés et appliqués au contexte du CRM. Attribution conservée pour cette adaptation.

Direction retenue avant réalisation :

1. **Produit** : organiser la mise en relation clients–artisans et suivre les chantiers et commissions.
2. **Caractère** : posé, précis, pratique pendant un appel.
3. **Univers** : le dossier de chantier et le carnet de suivi ; surfaces claires, lignes simples, informations lisibles.
4. **Points d'attention visuels** : l'action à mener et les résultats des chantiers ; violet Celexia concentré sur la sélection et les chiffres clés.
5. **Signature** : le parcours projet → artisan → devis signé, accompagné de statuts lisibles.

Logo, violet de marque, Plus Jakarta Sans et Clash Display conservés. Le projet avait une identité ; changer arbitrairement toutes ses couleurs aurait été une perte de cohérence.

## Constats et corrections

### Navigation et compréhension

| Problème initial | Conséquence | Résultat |
| --- | --- | --- |
| Plusieurs modules présents uniquement dans la sidebar desktop | Commissions, équipe, automatisations ou notes difficiles à trouver sur téléphone | Menu mobile complet, même source de navigation et mêmes règles de visibilité que sur ordinateur |
| « Pipe », « Tout le pipe », « Mon pipe », « À reprendre » employés pour des objets différents | Ambiguïté entre portefeuille, origine d'un dossier et travail de réattribution | Navigation « Projets », « Mes reprises », « À réattribuer » ; filtre « Issus d’une reprise » explicite |
| URL demandée perdue après connexion | Après ouverture d'un lien de dossier, retour à l'accueil au lieu du dossier | Destination interne conservée, query et fragment inclus |
| Actions d'en-tête en une ligne, titre tronqué | Fiches mal identifiées et commandes serrées sur mobile | Titre lisible, sous-titre pouvant revenir à la ligne, actions repliables |
| Indication active absente dans les fiches | Perte de repère dans l'application | Rubrique parente active, sans double sélection de la file de réattribution |
| Formulaire de création accessible malgré absence de droit | Saisie inutile avant refus serveur | Boutons masqués et gardes explicites des pages de création et de prise d’appel |
| Appellation « espace associés » à la connexion | Incohérence avec les comptes commerciaux | « Accès réservé à l’équipe Celexia » |

Fichiers principaux : `src/app/layout/`, `page-header.tsx`, `login-page.tsx`, `protected-route.tsx`, pages `*-new-page.tsx`.

### Tableau de bord et chiffres

| Problème initial | Conséquence | Résultat |
| --- | --- | --- |
| CA, commissions et volumes répétés sur une longue page | Difficile d'identifier le chiffre de référence | Une rangée principale CA / commission acquise / encaissée / reste à encaisser |
| Filtres de périodes indépendants | Chiffres non comparables semblant contradictoires | Un filtre commun mois courant / 90 jours / historique pour les résultats de transmission |
| Confusion date de création du projet, transmission à l'artisan et signature | Mauvaise interprétation des variations | Bases temporelles nommées ; historique six mois par date de signature distinct du filtre de transmission |
| Taux présentés comme portant sur tous les dossiers transmis | Dénominateurs mal compris | Libellés alignés sur le SQL : dossiers à issue connue, clos ou rendus ; dossiers en cours exclus selon l'indicateur |
| Chaque bloc traité avec le même poids visuel | Priorités noyées dans le reporting | Priorités, résultats, courbe principale et classement, puis portefeuille et détails repliables |
| Erreur RPC convertie en zéro ou absence | Impression que tout est payé ou qu'aucun dossier n'existe | Chargements, erreurs et réessais explicites |
| Commission potentielle au taux fixe de 10 %, fiches hors parcours incluses | Estimation interne trop approximative | Somme utilisant le taux de chaque projet, exclusion du démarchage, hypothèse indiquée |
| Lien « à attribuer » plus large que le compteur SQL | La destination contenait aussi des projets clos | File dédiée reproduisant les exclusions de `a_traiter()` |

Les règles financières SQL n'ont pas été changées. Les indicateurs restent fondés sur leurs RPC existantes. La qualité et l'exhaustivité des données en production n'ont pas été certifiées.

Fichiers : `src/features/dashboard/`, `src/features/commissions/commissions-page.tsx`, liste projets.

### Listes et saisie

- Recherche, métier et provenance des artisans conservés dans l'URL ; retour depuis une fiche sans perte de contexte.
- Distinction entre base vide, filtre sans résultat et requête échouée. Bouton d'effacement des filtres et action Réessayer.
- Recherche et contrôles de filtre nommés pour les lecteurs d'écran ; actions uniquement illustrées munies d'un nom accessible.
- Explication de la différence entre artisan ponctuel et partenaire régulier.
- Filtre de projets mémorisé par compte, stockage facultatif en cas de restrictions du navigateur.
- Création rapide sous forme de vrai formulaire : validation du téléphone requis et soumission avec Entrée.
- Modales défilantes avec hauteur maximale adaptée au viewport mobile.
- Fiches et formulaires d'édition projet/artisan indisponibles : message et retour à la liste au lieu d'un chargement permanent.
- Carte des montants : brouillon préservé pendant les actualisations, seuls les champs édités sont envoyés. Les champs intacts suivent les nouvelles données, notamment une signature reçue pendant la saisie.

### Accessibilité et design

Les badges utilisaient du blanc sur des couleurs trop claires : environ 2,15:1 pour « Devis envoyé », 2,28:1 pour « Devis signé », 2,43:1 pour « En attente », 2,80:1 pour « À rappeler ». Pour ces petits textes, la lisibilité était insuffisante.

Ils utilisent désormais un texte sombre sur surface claire et un point sémantique coloré. Le nom du statut transmet l'information sans dépendre uniquement de la couleur.

Autres changements :

- Surfaces, fonds et bordures neutres ; ombres réduites et sans halo violet.
- Plus de barre violette décorative sur chaque titre ; chiffres mis en avant par leur taille et leur alignement.
- Sidebar de 256 px ; espace de travail fluide jusqu'à 1440 px, avec formulaires gardant une largeur adaptée.
- Icônes cohérentes dans la navigation ; suppression d'emojis décoratifs dans les écrans retravaillés.
- Focus clavier visible, lien « Aller au contenu », tableau de valeurs accessible sous le graphique.
- Cibles des boutons adaptées au tactile ; préférence système de réduction des animations respectée.
- Connexion plus claire, message d'erreur persistant et commande afficher/masquer le mot de passe.

Il ne s'agit pas d'une certification WCAG exhaustive. Certains composants spécialisés conservent des styles et libellés historiques à harmoniser progressivement.

### Fiabilité et performance

- Cache de requêtes/mutations isolé lors d'un changement de compte ; rôle lié à la fiche de l'utilisateur courant.
- Indicateurs, commissions, affectations et listes dérivées invalidés ensemble après modifications des projets/affectations.
- Erreurs d'opérations secondaires d'affectation détectées ; rafraîchissement après échec partiel.
- Chargement des routes métier à la demande ; le shell reste visible pendant leur chargement.
- Chargement local différé de la maison 3D, supprimant l'import statique qui annulait le découpage de cette route.
- Fichier JavaScript principal passé de 1 118,54 à 513,75 Ko après découpage des routes (334,57 à 160,67 Ko gzip). Ce gain porte sur ce fichier, pas sur la taille totale de l'application ni sur un temps de chargement mesuré.
- Outils React Query activables explicitement en développement, pour que leur bouton flottant ne masque plus le menu mobile.

## Ce qui fonctionne déjà bien

- Métier riche : suivi agence, espaces artisans, affectations, devis, commissions, relances, équipe et métrés.
- Calculs financiers centralisés dans des fonctions SQL plutôt que reconstruits partout dans le front.
- RLS, gardes de rôles, protections de jetons et frontières d'erreur présentes dans les sources.
- Nombreux tests unitaires de devis et géométrie ; base TypeScript et composants partagés permettant des améliorations transversales.
- Recherche téléphonique et filtres métier déjà utiles au travail pendant les appels.

## Suites prioritaires

| Priorité | Sujet restant | Recommandation |
| --- | --- | --- |
| Haute | Affectation en plusieurs écritures non atomiques | RPC transactionnelle et tests de concurrence ; actuellement un échec partiel est visible mais pas annulé |
| Haute | Listes sans pagination et totaux parfois déduits des listes | Pagination/recherche serveur, agrégats dédiés ; vérifier les volumes et limites API réels avant migration |
| Moyenne | Géocodage avant sauvegarde, sans délai maximal | Timeout, conservation des coordonnées non concernées et enrichissement asynchrone |
| Moyenne | Relances rendez-vous/devis comptées par affectation mais liens filtrant le statut projet | Un filtre serveur renvoyant exactement les dossiers nécessitant une action |
| Moyenne | Génération des tâches pouvant échouer sans retour explicite du hook | Contrôler la RPC de régénération et distinguer liste existante de synchronisation réussie |
| Moyenne | Autres mutations directes gardant leur invalidation locale | Étendre le mécanisme commun aux encaissements depuis les tâches et autres chemins |
| Moyenne | Édition simultanée du même champ | Version serveur ou détection de conflit, au-delà de la protection des champs non modifiés |
| Moyenne | Écrans spécialisés volumineux (métré, 3D, espace artisan) | Revue dédiée avec vrais cas métier et mesures de performance sur téléphone |
| Faible | Taxonomie historique : « mort », « perdu », « artisan démarché », métiers Couverture/Toiture | Définir un glossaire partagé puis harmoniser interface et règles ; éviter un renommage aveugle des valeurs stockées |
| Faible | README en retard sur plusieurs évolutions | Mettre à jour modèle multi-artisans, équipe, migrations et procédures d'exploitation |

Une refonte des bases ou de la taxonomie nécessite de vérifier les données et contrats d'intégration concernés. Ce chantier n'a pas modifié ces règles silencieusement.

## Validation

**TypeScript, ESLint et build réussis ; 558 tests unitaires réussis (1 ignoré), 18 tests d’interface réussis.** Le [bilan de validation](2026-11-07-validation.md) détaille les commandes, captures, gains de build et limites. Les captures de test utilisent uniquement des données fictives.
