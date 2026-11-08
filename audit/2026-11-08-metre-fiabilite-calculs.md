# Fiabilité des calculs de métrés — 8 novembre 2026

Périmètre : chaîne géométrique serveur, conversions, nuages COPC, grilles IGN,
agrégation des quantités et report aux dossiers. Audit local, sans appel IA
payant, sans modification de chantier réel, sans recalcul de cache en production.
Les vérifications de sources publiques complémentaires sont dans
[l’audit des sources réelles](2026-11-08-metre-sources-reelles.md).

## Résultat

Des défauts concrets expliquaient des valeurs fausses, des valeurs absentes et
une confiance excessive. Ils ont été reproduits avant correction avec des
données synthétiques, des fichiers TIFF construits pour les cas limites et des
réponses HTTP fictives. Les dix nuages réels figés gardent exactement leurs
géométries et hauteurs après correction ; seule la version du moteur change.

| Défaut reproduit | Conséquence avant correction | Correction |
| --- | --- | --- |
| Aucun point classé sol, ou tous les points sol non finis | `solLocal` retournait 0 : une altitude absolue NGF pouvait devenir une hauteur de façade | Erreur explicite `sol_absent`, aucune hauteur inventée. Le cas valide avec sol à 200 m NGF conserve sa gouttière proche de 4,75 m |
| Une seule façade photographiée sur quatre | Le dossier recevait un total global de 1 ouverture / 1,5 m², malgré trois façades non lues | Aucun total global avant couverture complète ; les lectures individuelles restent disponibles |
| Surface nette calculée en soustrayant les ouvertures IA | La source annoncée était uniquement `lidar` | Source `ia_photo`, détail `source_brute: lidar` |
| Débord raster implicite de 40 cm | Un carré de 10 × 10 m plat donnait 116,67 m² | Débord inconnu = 0 ajouté ; mesure explicitement hors débord, à compléter par l’utilisateur. Les vrais débords du nuage restent mesurés |
| Précision de surface déduite d’un déplacement hypothétique du bord de 5 cm | Le dossier annonçait par exemple ±2,2 m² sans intervalle d’erreur global établi | `mesure_precision` nulle ; hypothèse conservée dans les détails, sans garantie de précision |
| TIFF valide à deux strips séparés | `[1,2,3,4]` était décodé `[1,2,0,0]`, en petit comme en grand boutiste | Lecture de chaque offset et taille de strip ; contrôle monobande float32 et orientation |
| TIFF tronqué | Des pixels manquants pouvaient être ignorés en lisant le mauvais strip | Rejet explicite `tiff_incomplet` avant calcul |
| Dimensions du TIFF différentes de la fenêtre demandée | La réponse était présentée comme « trop peu de toit » ; échelle et coordonnées n’étaient plus garanties | Rejet `grille_dimensions` |
| Coordonnées non finies / pixels infinis | Requêtes inutiles, erreurs internes de gradient ou hauteurs non finies | Validation du contour avant réseau ; exclusion des altitudes non finies dans pente, murs et hauteurs |
| Corps WMS lent après réception des en-têtes | Le délai de 20 s était déjà annulé, téléchargement potentiellement illimité | Délai conservé jusqu’à fin du corps, nettoyage en `finally`, trois essais bornés |
| Cache toiture alimenté avec le contour fourni par le navigateur | Un contour sans lien avec le `cleabs` pouvait devenir la mesure commune de ce bâtiment | Relecture BD TOPO, contrôle de l’identifiant trouvé et calcul sur son contour officiel avant écriture |
| Ancienne quantité automatique devenue absente après recalcul | L’upsert des seules quantités présentes laissait survivre l’ancien chiffre | Invalidation bornée aux clés absentes et sources automatiques, après lecture complète réussie |
| Panne de lecture des photos prise pour une liste vide | Les données manquantes semblaient une absence de source | Échec explicite avant toute écriture ; une réponse JSON non liste est aussi refusée |
| Upsert automatique sur une mesure dessinée | Le nouveau calcul pouvait remplacer la branche de mesure dessinée | Insertion sans écrasement puis PATCH conditionnel aux sources automatiques/nulles ; dessin/parcelle exclus |

## Chaîne parcourue et règles conservées

1. `_batiment.ts` identifie la maison BAN → RNB → BD TOPO. L’identité d’adresse
   et les transports sont audités séparément ; `toiture-lidar` réutilise la
   géométrie canonique trouvée par `parCleabs`.
2. `_lecture-releve.ts` transforme les coordonnées en Lambert-93, charge les
   dalles qui touchent la zone, fusionne les points et garde leur provenance.
3. `_lidar-hd.ts`, `_copc.ts`, `_laz.ts` demandent les plages HTTP et décodent le
   nuage classé. Aucun fichier complet de 180 Mo n’a été téléchargé pendant
   les contrôles réseau de cet audit.
4. `_nuage.ts` fournit le sol ; `_releve.ts`, `_pans.ts`, `_niveaux.ts` calculent
   recalage, contours, pans, débords, lignes et façades. Les terrasses et
   mitoyennetés conservent les règles existantes.
5. `_calcul-toit.ts` est le repli raster MNS/MNH LiDAR 50 cm puis MNS/MNT
   photogrammétrique 1 m. La pente reste le gradient du MNS, pas celui du MNH.
   Le nord reste en ligne 0, les unités de calcul en mètres, les pentes en %.
6. `_releve-retenu.ts`, `_toiture.ts`, `_mesures-chantier.ts` portent les règles
   communes écran/serveur. `_dossier-serveur.ts` les reporte selon le métier,
   sans remplacer les décisions humaines.

L’IGN distingue le nuage classé et ses produits dérivés MNT/MNS/MNH. Un point
de sol classé fournit une altitude, pas une hauteur de façade ; la différence
avec le toit nécessite une référence de sol valide.
[Documentation produit LiDAR HD IGN](https://geoservices.ign.fr/sites/default/files/2024-11/Fiche_produit_Nuages-de-points-LiDAR.pdf).

## Protection des dossiers et concurrence

`reporterAuDossier` attend des listes PostgREST valides pour les projets, photos
et matériaux. Une panne 503, un corps invalide ou une lecture incomplète
interrompt le report. Une liste vide reçue avec succès est une absence de
source, distincte d’une panne.

Les nouvelles clés sont insérées avec `resolution=ignore-duplicates`. Les
mesures existantes sont actualisées par PATCH filtré sur projet, clé, unité et
source parmi `lidar`, `photogrammetrie`, `ia_photo` ou source nulle. Les anciennes
quantités absentes ne sont effacées que pour ces trois sources automatiques.
Le code ne modifie ni `valeur_retenue`, ni `statut`, ni auteur, note ou valeur
déclarée. Le trigger existant `metrage_verifier` (migration 0171) préserve la
confirmation humaine. Les projets supprimés ou morts sont exclus.

Ce report n’est pas une transaction unique : une panne pendant les PATCH peut
laisser une actualisation partielle, mais elle n’autorise pas l’effacement sur
lecture amont incomplète. Les conditions s’appliquent côté base au moment de
l’écriture, notamment lorsqu’un dessin a été enregistré entre-temps. Aucune
nouvelle migration ni suppression massive n’est nécessaire.

## Cache et publication

- `VERSION_RELEVE` : **7 → 8**, afin de ne pas resservir un résultat calculé
  avec le sol de remplacement à zéro.
- `VERSION_TOITURE` : **3 → 4**, contour canonique et lecteur de grilles
  renforcé. Les résultats hors couverture portent également cette version.
- `pre-metre` et les lecteurs doivent utiliser ces constantes. Ne pas purger
  ni recalculer en masse les dossiers : un recalcul explicite/lazy utilise la
  nouvelle version. Les confirmations humaines restent retenues.
- `toiture-lidar` conserve la validation du jeton artisan existante. Sans
  `cleabs`, le calcul de contour reste possible, mais ne remplit aucun cache
  partagé. Un identifiant introuvable ne produit ni mesure ni écriture.
- Le CORS local utilise le helper partagé `_cors-metre.ts` ; aucune nouvelle
  dépendance externe n’a été ajoutée.

## Preuves de validation

Avant correction : **19 assertions nouvelles ont échoué** sur les défauts
visés. Après correction : les **24 nouveaux tests** des trois fichiers passent :

- `metre-fiabilite-calculs.test.ts` : 14 cas (sol, photos, provenance, débord,
  précision, TIFF, coordonnées, valeurs non finies et timeout du corps).
- `metre-toiture-acces-audit.test.ts` : 6 cas (autorisation, contour officiel,
  identifiant absent, ancien/nouveau cache et calcul sans cache).
- `metre-dossier-fiabilite.test.ts` : 4 cas (invalidation bornée, panne photos,
  protection dessin et rejet du relevé de confiance basse).

Les fixtures v7 sont conservées avec leur provenance historique. Le test de
réexécution compare tous les résultats à l’identique en ne normalisant que le
champ version attendu. La suite des six références indépendantes ne peut plus
disparaître silencieusement si un fichier manque : le filtre `existsSync` a
été retiré.

Un seul test reste volontairement ignoré : la surface de toit de Nogent44,
dont la référence raster englobe des voisins mitoyens et n’est donc pas une
référence fiable pour ce toit. Les pentes, hauteurs et autres contrôles de
cette maison restent exécutés. Ce n’est pas une validation de sa surface.

Commandes exécutées :

```text
npx vitest run tests/unit/metre-*.test.ts
npx tsc -b --noEmit
npx eslint [fichiers de calcul, endpoint et tests modifiés]
```

Dernier passage à 11:48 UTC : **499 tests passés, 1 ignoré**, 27 fichiers de
tests métrés ; typecheck et lint ciblé réussis. La revue
indépendante a aussi relu les règles de concurrence/trigger et décodé avec le
nouveau lecteur trois captures publiques réelles (60×62, 72×74, 36×37), sans
blocage identifié.

## Contrôles publics et limites

Contrôle réseau gratuit sur la fixture publique Sathonay-Camp,
`BATIMENT0000002209748162`, zone Lambert-93 `845210,6525921,845240,6525952` :

- Métadonnées WFS : HTTP 200, une dalle, vol `2021-09-24`.
- MNS LiDAR WMS : HTTP 200, TIFF 60×62, float32 mono-bande non compressé,
  15 393 octets, un strip. Le défaut multi-strip est un défaut de décodeur
  prouvé sur un TIFF synthétique valide, pas un incident constaté sur cette
  réponse précise de l’IGN.
- COPC : Node et agent HTTP `Deno/2.6.8`, plage 0–4095, HTTP 206, 4 096 octets,
  en-tête LAS et `Content-Range` correct. Une requête HEAD / urllib Python a
  reçu 403 ; cela ne prouve pas une panne du chemin utilisé en production.
- La date de publication du fichier (2025) n’est pas celle du vol (2021).
  Les changements de bâtiment postérieurs au vol restent invisibles.

Les contrôles des fournisseurs confirment un accès aux données, pas les mesures
d’un chantier privé. Les références réelles existantes sont elles-mêmes issues
de données IGN ; les tests synthétiques apportent une référence géométrique
indépendante, mais aucune campagne terrain au télémètre n’a été réalisée.

Limites non résolues par cet audit : sol très clairsemé mais non vide, mélange
de dates sur plusieurs dalles (le champ `vol` retient encore la plus récente),
toitures reconstruites partiellement et évolution du bâtiment depuis le vol.
Le niveau de confiance est une heuristique de densité/recalage/couverture,
pas une probabilité statistique. La sensibilité théorique à 5 cm sur le bord
ne couvre pas ces causes d’erreur et ne doit plus être présentée comme une
précision garantie. Les données raster restent un repli approximatif au droit
des murs, avec débords à renseigner.
