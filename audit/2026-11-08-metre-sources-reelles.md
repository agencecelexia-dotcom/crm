# Métrés — disponibilité réelle des sources publiques

Contrôle du **8 novembre 2026, 11:43–11:44 UTC**, depuis Node 24.18.1. Les résultats détaillés sans adresse nominative sont conservés dans [le relevé JSON](2026-11-08-metre-sources-reelles.json).

## Périmètre et résultat

Les deux bâtiments proviennent uniquement des fixtures publiques déjà présentes dans le dépôt :

| Fixture | Identifiant BD TOPO | Point central WGS84 | Zone Lambert-93 |
|---|---|---|---|
| `tests/fixtures/copc/deux-pans-simple/maison.json` | `BATIMENT0000002209748162` | 4.8704385925, 45.817584495 | 845210,6525921 → 845240,6525952 |
| `tests/fixtures/lidar/photogrammetrie/maison.json` | `BATIMENT0000000316210699` | −3.6319038956, 47.8138106122 | 204220,6766747 → 204256,6766784 |

**Les endpoints interrogés fonctionnent sur ces deux zones.** Les formats reçus correspondent aux champs utilisés par le code. Aucun endpoint à remplacer d’urgence n’a été identifié.

Le contrôle a utilisé 17 GET principaux (101 340 octets reçus), puis quatre GET complémentaires de compatibilité BAN. Les demandes avaient un délai de 10–20 secondes ; les fichiers COPC ont été limités aux 4 096 premiers octets chacun. Aucun appel à une fonction edge du CRM, aucune base métier, aucun jeton, aucun service d’IA ou envoi de message. Aucun relevé sur un chantier réel n’a été déclenché.

## Résultats observés

| Source | Deux pans simples | Fixture photogrammétrie | Compatibilité vérifiée |
|---|---|---|---|
| BD TOPO WFS | HTTP200, 12 bâtiments ; identifiant cible trouvé, hauteur 6,8m | HTTP200, 11 bâtiments ; cible trouvée, hauteur 9,2m | `features[].properties.cleabs`, hauteur numérique, géométrie `MultiPolygon` ; filtre spatial de 40m utilisé par `_batiment.ts` |
| BAN actuelle IGN, reverse puis search | HTTP200 ; adresse au numéro ; ID `69292_0708_00001` | HTTP200 ; adresse au numéro ; ID `29150_0020_00023` | ID d’interopérabilité BAN, label, commune, code postal, rue, numéro, score et coordonnées présents |
| Ancien endpoint BAN utilisé par le code | Reverse et search HTTP200 sans redirection ; search donne un résultat et le même ID | Même résultat | `https://api-adresse.data.gouv.fr/search/` reste fonctionnel lors de cette lecture |
| RNB filtré par clé BAN | HTTP200, lien BD TOPO cible trouvé | HTTP200, deux liens BD TOPO dont la cible | `results`, `status='constructed'`, `ext_ids.source='bdtopo'`, point WGS84 présents |
| Métadonnées LiDAR HD WFS | Une dalle, fin de vol 2021-09-24 | Une dalle, fin de vol 2024-12-12 | Couche `IGNF_LIDAR-HD_METADONNEE:metadata`, champs `url_npl` et `date_fin_acquisition` |
| COPC GET Range | HTTP206, 4 096 octets, `Content-Range: bytes 0-4095/179920084` | HTTP206, 4 096 octets, `Content-Range: bytes 0-4095/103675252` | Signature `LASF` reçue ; URL `.copc.laz` publique |
| MNS LiDAR WMS GeoTIFF | HTTP200, 60×62, 3 720/3 720 pixels valides, altitudes 269,17–278,35m | HTTP200, 72×74, 5 328/5 328 pixels valides, altitudes 53,91–69,44m | GeoTIFF décodé par `lireGeoTiff`, float32, aucune valeur −9999 dans ces extraits |
| MNS photogrammétrique WMS | Non demandé | HTTP200, 36×37, 1 332/1 332 pixels valides, altitudes 54,55–68,80m | Repli raster public disponible également |

Les plages COPC sont celles qu’utilise le moteur. Un refus d’une requête HEAD ou d’un autre client HTTP ne suffit pas à conclure que ce téléchargement par plages est indisponible : le GET Range réel a répondu 206 dans les deux cas.

### Couverture historique devenue obsolète

La fixture `lidar/photogrammetrie` est décrite comme hors LiDAR à Moëlan-sur-Mer. Elle **est désormais couverte** : la métadonnée renvoie un vol du 12 décembre 2024, et l’URL COPC se trouve dans l’édition `NUALHD_1-0__LAZ_LAMB93_BG_2026-09-21`. Le MNS LiDAR actuel est lui aussi rempli de valeurs valides.

La fixture figée conserve sa valeur pour tester le repli photogrammétrique. Sa description ne constitue plus une preuve d’absence de couverture actuelle. Aucun remplacement des fichiers historiques de test n’a été effectué. Aucun exemple encore hors couverture n’a été établi au cours de cette passe ; les deux points retenus sont couverts aujourd’hui.

## Délais HTTP : défaut reproduit et corrigé

Dans [`_batiment.ts:27`](../supabase/functions/_batiment.ts), `lireJson` arrêtait son minuteur juste après `fetch`, avant `await response.text()`. Un service envoyant ses en-têtes HTTP200 puis bloquant son corps pouvait laisser l’identification de maison attendre sans borne. Une erreur de connexion pouvait également laisser le minuteur actif jusqu’à son expiration.

Le minuteur reste maintenant actif jusqu’à la lecture et au parsing du corps, puis il est nettoyé dans `finally`, succès ou erreur. Les délais existants, les réessais et les URL restent inchangés. Aucun résultat vide ou JSON incomplet n’est converti en mesure valide.

[Tests dédiés](../tests/unit/metre-sources-http.test.ts) :

1. Corps HTTP200 bloqué : le signal expire et interrompt la lecture.
2. Corps expiré puis seconde réponse valide : le réessai aboutit, sans minuteur restant.
3. Connexion rompue avant les en-têtes : nettoyage du minuteur.
4. Réponse JSON complète et corps vide : succès normal / erreur conservée, sans minuteur restant.

**37/37 tests ciblés réussis** (`metre-sources-http`, `metre-adresse`, `metre-parcelle`, `metre-batiment`), dont quatre nouveaux tests HTTP. ESLint ciblé et vérification des espaces Git réussis. Le typecheck global est consigné avec le bilan commun du lot.

## Caches et anciens statuts — lecture du code, sans accès aux données métier

| Comportement actuel | Conséquence et proposition |
|---|---|
| [`reserver_releve`, migration0177:142](../supabase/migrations/0177_releve_batiment.sql) protège un calcul `en_cours` de moins de six minutes. À version identique, un état `en_cours` ou `echec` ne peut ensuite être repris qu’après une heure, ou un jour à partir de trois essais. | Un calcul interrompu peut rester affiché comme ancien `en_cours` malgré un service public redevenu disponible. Le bouton de réessai côté écran ne contourne pas cette règle serveur. Une évolution éventuelle doit présenter la date réelle de prochaine tentative et distinguer explicitement calcul actif et réservation expirée. |
| `hors_couverture` de même version est conservé 90jours, puis une nouvelle réservation devient possible. | La publication d’une dalle récente peut ne pas être détectée immédiatement. Le cas Moëlan prouve que la couverture évolue ; il ne prouve pas qu’un cache de production est actuellement périmé. Une actualisation autorisée doit éviter les rafales de recalcul. |
| `fait` et `introuvable` de même version ne périment pas dans cette fonction. Une nouvelle version du moteur autorise une reprise. | Une correction BD TOPO ou un nouveau vol n’actualise pas spontanément ces lignes. Prévoir séparément un âge des données et une politique d’actualisation, en gardant les anciennes quantités vérifiées distinctes. |
| [`toiture-lidar/index.ts:68`](../supabase/functions/toiture-lidar/index.ts) sert son cache si la version atteint `VERSION_TOITURE` et `rafraichir` absent, sans contrôle de `mesure_le`. | Un ancien résultat raster peut rester servi. Le paramètre de rafraîchissement existe ; son exposition ou une durée de validité serait une évolution de politique, non une réparation d’URL. |
| [`use-releve.ts`](../src/features/metre/use-releve.ts) garde les données locales fraîches24h et arrête l’attente active après trois minutes ; `reprendre` réinitialise l’attente locale puis redemande au serveur. | Le délai d’interface et les limites serveur ne représentent pas la même chose. Ce contrôle n’a pas lu les caches des utilisateurs ni modifié ces règles. |

Le lot moteur coordonné séparément porte désormais `VERSION_TOITURE` à4 et `VERSION_RELEVE` à8 : les versions précédentes deviennent recalculables selon les gardes existantes. Le nouveau lecteur TIFF a également été exécuté sur les trois extraits publics gardés lors de cette lecture : mêmes dimensions et nombres de pixels valides, sans nouveau réseau. La politique d’expiration à version identique décrite ci-dessus reste distincte.

Aucune nouvelle migration ni purge de cache n’est justifiée par ces seuls constats. Les changements d’expiration doivent être testés avec les réservations concurrentes, les quotas et la préservation des mesures confirmées. La correction de lecture HTTP est indépendante de cette politique.

## Documentation officielle et limites

L’[IGN documente les endpoints actuels de géocodage](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) `data.geopf.fr/geocodage/search` et `/reverse`, basés notamment sur la BAN. La [page officielle du RNB](https://rnb.beta.gouv.fr/outils-services) renvoie à ses API publiques. Leur fonctionnement observé sur les fixtures est détaillé ci-dessus. La migration de l’ancien domaine BAN peut être planifiée séparément, avec vérification des résultats d’adresses ; son maintien actuel ne garantit pas sa pérennité.

Cette passe vérifie les réponses publiques et leur format, depuis l’environnement local. Elle n’atteste ni la disponibilité depuis une région Supabase précise, ni les permissions des fonctions déployées. Les 4Ko COPC ne constituent pas une extraction complète du nuage : aucune pente, façade ou surface de toiture n’a été recalculée sur données distantes dans cette passe. La justesse géométrique relève des tests moteur sur les nuages figés, coordonnés séparément. Les deux bâtiments ne prouvent pas une couverture nationale, et un HTTP200 raster doit toujours être accompagné d’un contrôle des pixels valides.
