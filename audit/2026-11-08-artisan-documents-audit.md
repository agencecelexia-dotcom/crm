# Audit fonctionnel — documents de l’espace artisan

Date : 8 novembre 2026. Périmètre : devis, bibliothèque et IA, PDF, pièces déposées/partagées, entreprise, assurances, contrat et commissions. Audit avant correction ; les résultats ci-dessous décrivent cette baseline. Vérifications exclusivement locales : fixtures fictives, réseau externe bloqué, aucun email, upload ou signature réels.

## Résultat initial

Six scénarios Playwright écrits avant correction échouent sur six défauts distincts. Six tests unitaires de messagerie échouent également. Traces et captures : `test-results/audit-documents-baseline/`. Les erreurs de scénarios sont des assertions métier, pas des erreurs d’installation. La lecture des migrations apporte des contrôles complémentaires ; elle ne prouve pas à elle seule leur déploiement en production.

## Inventaire des fonctionnalités

| Domaine | Fonctions observées | Frictions et limites |
| --- | --- | --- |
| Mes devis | Liste, référence, client, objet, date, total, statut, filtres tous/brouillons/envoyés, PDF, nouveau devis, états vide/erreur/réessayer | Brouillon sans reprise réelle ; pas de recherche ; PDF absent sans résolution proposée ; statut inconnu présenté comme brouillon. |
| Générateur | Client/entreprise, objet, prestations ajout/suppression, quantité/unité/prix/déboursé/TVA, régime TVA, calcul HT/TVA/TTC, marge et commission, acompte et conditions | Fermeture incomplètement protégée ; champs encore modifiables pendant sauvegarde ; saisies financières permissives ; identité reçue tard non reprise dans l’en-tête. |
| Démarrage | Modèles personnels et de référence, ajout de plusieurs modèles, huit devis récents à recopier | « Reprendre un devis » copie uniquement ses lignes/objet/TVA dans un nouveau devis ; ne reprend ni client ni conditions ni numéro. Terme trompeur pour un brouillon. Erreurs modèles/devis masquées comme absence. |
| Bibliothèque | Prix personnels, six suggestions puis recherche jusqu’à vingt résultats, mémorisation après sauvegarde | Échec de lecture masqué ; pas de gestion dédiée ; erreur de mémorisation silencieuse, acceptable seulement si présentée comme secondaire. |
| Modèles | Enregistrer les lignes sous un nom/métier, supprimer un modèle personnel | Suppression sans confirmation, sans état désactivé ni message d’erreur ; refus JSON potentiellement ignoré. Gestion accessible seulement lorsqu’un devis comporte une ligne. |
| Suggestions IA | Exploite contexte et échanges, montre propositions/manques/source, ajoute tout ou certaines lignes | Le backend `devis-suggerer` fait confiance aux prix proposés par l’IA, malgré le texte « jamais inventé » ; contrairement à l’entretien, aucun rattachement serveur des prix dans cette fonction. |
| Entretien IA | Description, questions/réponses, marge optionnelle 1–79 %, retour, composition, hypothèses/manques, résultat à chiffrer, insertion | Questions non associées aux inputs par id/htmlFor ; retour possible pendant requête, réponse tardive change l’étape ; description/entretien perdu à la fermeture ; deux portes IA partiellement redondantes et garanties différentes. |
| PDF/HTML | Devis A4, logo, entreprise/client, lignes, ventilation TVA, acompte, assurances, médiateur, banque, CGV, aperçu et téléchargement | Aperçu télécharge plutôt qu’affiche ; erreur non capturée ; génération doublée à l’enregistrement ; textes longs de coordonnées non repliés ; ligne démesurée peut dépasser une page. Couleurs PDF encore distinctes du portail. |
| Sauvegarde/envoi | Réservation numéro, sauvegarde lignes, bibliothèque, génération PDF, stockage, URL, téléchargement ou email client, synchronisation CRM | Chaîne non atomique, sans reprise après échec, statut envoyé prématuré, absence de preuve de prise en charge du webhook. |
| Dépôt devis/signé | Glisser/déposer, choix PDF, remplacer, ouvrir reçu, montant TTC manuel, extraction PDF facultative | Pas de limite de taille visible ; filtre MIME permissif ; dépôt et montant indépendants ; montant refusé silencieusement lors du dépôt, puis succès global. Drag/drop peut démarrer un second upload pendant le premier. |
| Documents partagés | Liste pièces autorisées, catégorie/taille/date, miniature image, ouvrir/télécharger par URL signée, erreurs liste/retry | Échec URL explicite mais exception réseau non capturée ; popup de secours remplace la page courante. Edge ne vérifie pas l’exclusion artisan, contrairement aux RPC récentes. |
| Entreprise | Coordonnées/identité légale, logo, TVA/acompte/paiement, banque, assurances, médiateur, zone, CGV personnalisées/défaut | CGV inchangées réinitialisées ; défaut CGV non explicitement demandé ; champs vidés conservés par SQL, sans explication ; invalidation mauvaise clé du portail ; formulaire fermé sans protection des modifications. |
| Assurances | Décennale et RC pro, statuts reçu/validé/expiré, lecture IA, correction champs, dépôt, refus explicites, activation chiffrage | MIME/taille non validés avant lecture ; refus upload après lecture ; remplacement retire la validation (règle correcte mais mérite annonce) ; identité assurance en cache non invalidée. |
| Contrat | Lecture, consentement, identité signataire, signature dessinée, validation serveur, téléchargement signé, empreinte/preuve serveur | Deux écrans de signature maintenus en parallèle ; absence de verrou synchrone côté UI mais SQL empêche une seconde signature ; erreur fonctionnelle peu détaillée ; PDF sans état occupé/erreur. Aucun document signé réellement pendant l’audit. |
| Commissions | Total dû/réglé/reste, lignes assiette/taux/montant/statut/date/PDF, export CSV, états vide/erreur | CSV cite les cellules mais laisse exécuter une formule textuelle ; bonne distinction assiette/taux conservée ; pas de faux zéro lors de panne. |

## Anomalies prioritaires, preuve et conséquence

### P1 — Perte de travail ou état financier trompeur

1. **DOC-03 — sauvegarde non idempotente.** `devis-builder.tsx`, `enregistrer` : création avant PDF/upload puis ID local non conservé. Un HTTP 503 stockage suivi de Réessayer effectue deux créations sans clé stable. Reproduction Playwright avec stockage simulé refusé. Un téléchargement local en échec après sauvegarde peut produire le même effet. Il faut une vraie mise à jour de brouillon et une clé de création stable vérifiée en base, plus une liste invalidée dès réservation.
2. **Envoi déclaré avant transmission.** `enregistrer` appelle `envoyer_devis_by_token` avant le webhook. `use-devis.ts` utilise `mode: no-cors`, ignore `response.ok`. Les HTTP 400/429/500/503 et une réponse opaque se résolvent en succès dans les six tests unitaires. Un état envoyé dans le CRM ne prouve donc même pas la prise en charge serveur. Correction requise : endpoint serveur autorisé, accusé explicite et anti-doublon ; ne pas promettre réception dans la boîte du client.
3. **DOC-02 — CGV personnalisées effacées sans demande.** `carte-identite.tsx/soumettre` envoie `cgv: ''` quand le texte est égal à celui chargé. La migration 0139 interprète précisément `''` comme retour aux défauts. Reproduction : ouvrir Modifier CGV, ne rien changer, Enregistrer → payload vide. Il faut distinguer conservation, modification et reset explicite.
4. **DOC-01 — fermeture perd client/objet.** `demanderFermeture` protège seulement `lignesRemplies`. Reproduction client + objet saisis, aucune ligne nommée, Fermer → aucune confirmation et panneau fermé. Même risque avec conditions/déboursés et pendant une opération occupée. Protéger toutes les modifications et la fermeture navigateur.
5. **DOC-06 — brouillon sans chemin de reprise.** MesDevis affiche un brouillon mais seulement le PDF s’il existe. Le menu « Reprendre un devis » du générateur ne fait qu’une copie dans un nouveau numéro. Reproduction UI : aucune action Reprendre pour DEV-2026-015. L’utilisateur doit pouvoir retrouver son brouillon, modifier et sauvegarder le même ID/numéro.
6. **Deux conventions d’arrondi.** `calculs.ts/ventiler` arrondit chaque ligne puis TVA par taux ; `creer_devis_by_token` (0156) somme les valeurs brutes puis arrondit HT/TVA/TTC indépendamment. Exemple 5 × 33,33 à 10 % : écran/PDF 183,32 ; SQL 183,31. Unifier pour les futures sauvegardes, sans recalcul rétroactif des devis existants.
7. **Lignes sans désignation.** Le récapitulatif inclut toutes les lignes ; payload/PDF filtrent celles sans désignation. Ajouter une ligne vide avec un prix change le récapitulatif sans ajouter la prestation au PDF. Refuser la ligne incomplète avant sauvegarde et ne totaliser que les prestations retenues.
8. **DOC-04 — valeurs invalides.** Validation UI refuse quantité négative mais pas prix négatif ni acompte hors 0–100 ; `parseFloat` tronque des valeurs malformées. La dernière fonction SQL de création consultée ne valide pas ces bornes. Reproduction prix −100 : une RPC est appelée, aucune erreur métier locale. Vérifications cohérentes UI et serveur nécessaires.
9. **URL PDF refusée traitée comme succès.** `useSetDevisPdf` ne vérifie que `error`, pas `{ok:false}`. Le PDF peut être perdu en liste après succès affiché. Même problème dans certaines mutations de prix et suppression modèle.
10. **Montant de dépôt refusé silencieusement.** `UploadDevis.enregistrerMontant(true)` absorbe une erreur et `traiter` affiche « envoyé ». Le PDF peut être reçu avec un montant antérieur ou nul qui sert aux commissions. Succès du fichier et échec du montant doivent être distingués ; aucun auto-enregistrement ambigu.

### P1/P2 — Accès et intégrité des exports

11. **Document signé pour artisan écarté.** `document-signe/index.ts` vérifie affectation non retirée et pièce visible, mais pas `artisans.ecarte_at`. Le chemin de lecture échappe donc à la règle d’exclusion ajoutée aux RPC. Constat de code, pas tentative contre production. Vérifier actif + contrat signé + projet vivant avant signature d’URL.
12. **DOC-05 — CSV formule.** Une identité fictive `=1+1` apparaît telle quelle dans le CSV, entourée de guillemets. Ces guillemets n’empêchent pas l’interprétation tableur. Neutraliser les préfixes formule sur les cellules textuelles sans convertir les montants numériques en texte.
13. **HTML du mail artisan.** `envoyerDevisPdfEmail` insère client_nom et numero sans échappement. Test nom `<img ...>` retrouve le tag dans HTML. La fonction n’a actuellement pas d’appelant UI ; supprimer le chemin inutilisé ou le sécuriser plutôt que le laisser comme primitive piège.

### P2 — Cohérence, récupération, clarté

14. `useEnregistrerIdentite` invalide `['espace-artisan', token]` alors que le portail lit `['espace', token]` ; nom/adresse du vendeur peuvent rester anciens après modification. Le builder initialise l’en-tête une fois avant la réponse identité.
15. `useDeposerAssurance` invalide uniquement `chiffrage` ; l’identité utilisée pour imprimer les assurances peut rester en cache.
16. Les champs d’identité vidés sont rétablis en base par `coalesce(nullif(...), existant)`. Une suppression apparente d’IBAN/coordonnée ne prend pas effet. Le formulaire annonce pourtant enregistré.
17. Aucun retour d’erreur de chargement pour modèles/bibliothèque, ce qui les fait disparaître et ressemble à une perte de données. Boutons de suppression modèle sans retour d’échec.
18. Upload logo avant enregistrement ; fichier orphelin en cas d’annulation. Même séquence fichier puis RPC pour devis/assurance : un échec de rattachement laisse un fichier sans référence. Nettoyage/rétention à prévoir côté stockage, sans effacer un fichier encore référencé.
19. Lecture assurance autorise 6 Mo environ côté serveur, mais le client ne bloque pas un fichier plus lourd ou d’un type non admis avant conversion base64. Éviter cette requête inutile, afficher la limite et garder saisie manuelle en cas d’échec de lecture admissible.
20. Suggestions IA et entretien n’ont pas la même garantie de prix : l’entretien rattache les prix en SQL, les suggestions acceptent la sortie modèle. Unifier sur le rattachement catalogue ; aucune valeur inventée dans l’interface de test.
21. « Aperçu » lance un téléchargement. Préférer aperçu navigateur/PDF distinct du téléchargement, ou libellé explicite ; capturer l’échec et éviter deux générations identiques.
22. Deux textes de conditions de paiement (`conditions`, `conditionsPaiement` de l’identité) peuvent diverger sur le même document. Donner une source effective unique, tout en conservant CGV et mentions métier.

## Garde-fous déjà présents et à conserver

- Liste/assurances/relevé distinguent panne, vide et chargement, avec retry.
- Chiffrage ouvert seulement après assurances valides ; backend `peut_chiffrer` contrôle aussi la création.
- Contrat signé figé en base, signataire/image contrôlés, artisan écarté refusé, preuve conservée (0162).
- Montants déposés bornés en SQL à 0–10 000 000 ; échec UI à rendre explicite, pas suppression du garde-fou.
- Avenant envoyé ne fait plus reculer un chantier signé/terminé ni remplacer son montant signé (0164).
- Entretien IA : rattachement des prix hors modèle, marge limitée, prix inconnus à compléter.
- PDF/HTML partagent l’arrondi par ligne et TVA par taux ; déboursés/marge exclus des documents client.
- Les URLs document signées n’exposent pas le chemin privé permanent et expirent après une heure.

## Validation initiale

Commande UI : `ARTISAN_AUDIT_SHARED_SERVER=1 npx playwright test --config tests/interface.config.ts tests/artisan-documents-audit.spec.ts --project=desktop --workers=1 --output=test-results/audit-documents-baseline` → **6 échecs attendus avant correction**.

Commande unitaires : `npx vitest run tests/unit/artisan-documents-audit.test.ts` → **6 échecs attendus avant correction** (4 statuts HTTP, réponse opaque, HTML non échappé).

Les tests ajoutés visent les limites et transitions. Ils complètent les tests existants de responsive, calculs/PDF/HTML, accès avant signature et états vides/erreur. La validation finale doit réexécuter ces régressions desktop/mobile, vérifier les branches échec/retour, et tester la migration sur une base de test avant publication. Le workflow mail externe et la livraison effective ne sont pas validés par une simulation locale.

## Corrections et validation après audit

Les six régressions initiales sont corrigées. La suite a été élargie à **19 scénarios UI**, exécutés sur desktop et mobile (38 cas), et à **22 tests unitaires** dédiés aux réponses mail, à la source PDF et au workflow préparé. Les fichiers de preuves finaux sont dans `test-results/audit-documents-final/`. Le typecheck, ESLint ciblé et `git diff --check` réussissent.

`npm run test:sql` charge réellement les **187 migrations** dans PostgreSQL local (PGlite, réseau simulé), puis exécute cinq suites. `artisan_devis_audit.sql` vérifie création/reprise, conservation du numéro, arrondis, bornes, propriété, CGV, effacement explicite et transitions d’envoi. La suite `artisan_envoi_rejeu_audit.sql`, ajoutée lors de la revue indépendante, vérifie la consommation durable d’une tentative avant Gmail.

### Résultats livrés

- Sauvegarde d’un même brouillon, clé stable et empreinte de contenu : une réponse perdue ne crée pas un second devis ni une nouvelle révision identique. La liste est invalidée dès la sauvegarde, même si la suite PDF échoue.
- Véritable action **Reprendre**, avec client, lignes, TVA, conditions, acompte et numéro conservés. L’ancienne copie est explicitement nommée **Copier les lignes d’un devis**.
- Fermeture protégée pour client/objet/conditions, changements entreprise et entretien ; génération/sauvegarde en cours protégée ; avertissement de fermeture navigateur pour le devis. Champs désactivés pendant la sauvegarde.
- Nombres et acomptes contrôlés ; ligne chiffrée sans désignation refusée ; total limité aux lignes retenues ; arrondis serveur alignés sur l’écran/PDF. Refus d’URL PDF correctement remonté.
- CGV inchangées conservées ; retour aux défauts explicitement confirmé ; effacement de champs facultatifs réellement appliqué ; cache entreprise/assurances corrigé ; panne d’identité bloque la génération au lieu d’utiliser un régime TVA de repli.
- Prix et modèles indisponibles annoncés avec retry ; suppression modèle confirmée et refus visible ; questions de l’entretien associées aux champs ; retour empêché pendant requête IA.
- PDF déposé limité à 10 Mo, attestations à 6 Mo ; formats refusés avant lecture/téléversement ; seconde dépose verrouillée pendant l’envoi ; distinction **PDF reçu, montant non enregistré**. Un refus d’assurance conserve la saisie corrigée.
- Documents partagés : erreurs récupérables ; contrôles serveur artisan écarté, contrat, projet supprimé/mort, affectation retirée/masquée. CSV neutralise les préfixes de formule textuelle.
- Lecture des **devis/PDF historiques conservée quand les assurances bloquent le chiffrage**. Seules création/modification sont désactivées. Envoi ambigu visible sous **Envoi à vérifier**, sans action de renvoi, avec contact Celexia.
- Envoi déplacé vers un endpoint serveur avec réservation durable, accusé explicite et corrélé ; aucune mutation directe du statut envoyé par le navigateur. Timeout/résultat ambigu bloque le renvoi automatique. Le workflow dédié prépare la pièce jointe et répond après la remise Gmail. Le marquage CRM est postérieur à l’accusé ; il ne signifie pas que le client a reçu ou lu le mail.

### Anomalie supplémentaire trouvée en revue indépendante

**PDF et données issus de deux onglets différents.** Avant le correctif final, A pouvait sauvegarder 100 €, B sauvegarder 200 €, puis A rattacher tardivement son PDF de 100 € au devis de B. Une révision persistante est maintenant exigée lors de l’édition, du rattachement du PDF et de la réservation de l’envoi. Le SQL teste cet entrelacement : PDF périmé, édition obsolète et envoi d’une ancienne révision sont refusés. Le test UI DOC-19 confirme qu’un refus PDF ne déclenche pas l’endpoint d’envoi et conserve les saisies visibles.

### Limites restant explicites

- Les appels Gmail/n8n, les uploads de production et la qualité d’une réponse IA réelle n’ont pas été exercés ; tous les scénarios UI sont simulés. La lecture des migrations n’est plus la seule preuve SQL, mais l’environnement PostgreSQL local ne remplace pas la vérification de déploiement cible.
- Le rendu des PDF longs est désormais couvert par la reprise décrite ci-dessous. Les miniatures de chaque format média et l’extraction automatique d’un vrai scan restent hors de cette suite ; l’extraction d’un PDF natif et le rejet d’un PDF corrompu sont couverts par DOC-21. Les tests de calcul/HTML existants restent nécessaires.
- Les dépôts suivis d’un refus de rattachement peuvent laisser des fichiers orphelins. Aucun nettoyage automatique du stockage n’a été ajouté : supprimer sans vérifier toutes les références serait destructeur.
- L’aperçu intégré distinct du téléchargement est livré dans la reprise ci-dessous. Le téléchargement de l’aperçu reste un document local : il ne réserve pas de numéro et ne remplace pas l’enregistrement.
- Une intervention agence est encore nécessaire pour réconcilier une tentative d’envoi ambiguë. Aucun écran d’administration de cette réconciliation n’est ajouté ici ; ne pas lever automatiquement ce verrou sur simple expiration.
- Contrat/signature et logo sont audités/testés dans le lot racine séparé. Les prix des suggestions IA sont sécurisés dans le lot racine, avec leurs tests catalogue et SQL ; cette suite teste l’entretien et la conservation d’un prix inconnu, pas la génération distante réelle.

### Compatibilité pendant la publication

Le nouveau formulaire vérifie désormais **avant toute création** la RPC de lecture `capacites_devis_by_token` ajoutée à 0185. Elle annonce le protocole 2, la sauvegarde idempotente et les révisions, uniquement pour un artisan actif avec contrat et assurances validés. Le contrôle est renouvelé à chaque tentative, sans cache de succès.

Cette protection est nécessaire tant qu’un ancien backend peut être utilisé : l’ancienne fonction `creer_devis_by_token` ignore les nouveaux champs `devis_id` et `idempotency_key`, puis crée un autre numéro avant que le frontend constate l’absence de révision. Avec le garde-fou, fonction de capacités absente (404), version ancienne et vérification indisponible (503) produisent un message de maintenance, conservent la saisie et déclenchent **zéro appel de création**. Trois scénarios DOC-20 ont été reproduits en échec avant correctif ; ils complètent la suite initiale et sont exécutés sur desktop/mobile. Le SQL contrôle également les capacités pour jetons inconnus, artisans écartés, contrats absents et assurances non validées.

Validation finale de ce garde-fou : **44/44 cas UI réussis** (22 scénarios × desktop/mobile), **188 migrations et 6 suites SQL réussies**, TypeScript, ESLint ciblé et `git diff --check` réussis. Preuves : `test-results/audit-documents-compatibilite/`. La suite confirme aussi que le backend moderne conserve les sauvegardes et reprises déjà testées.

## Reprise après PR 83 : aperçu PDF intégré et devis longs

Le bouton **Aperçu** ouvre maintenant un lecteur dans le formulaire. Il affiche le véritable PDF généré par jsPDF, rendu par PDF.js 6.2.108, sans appel de création, stockage ni envoi. Le brouillon reste monté avec toutes ses saisies ; **Revenir au devis** et Échap referment seulement le lecteur et restituent le focus au bouton Aperçu. Une nouvelle ouverture reflète les dernières modifications. Les actions **Enregistrer** et **Au client** conservent leur comportement antérieur et les protections de révision existantes.

Le lecteur propose pages précédente/suivante, sélection d’une page, zoom et retour à la largeur. **Télécharger** est une action distincte portant exactement sur le Blob affiché, sans seconde génération. Le numéro d’un nouveau devis est explicitement réservé à l’enregistrement ; un brouillon repris garde son numéro. La vue **Afficher le texte** donne accès au texte extrait du même PDF, également disponible aux lecteurs d’écran. Le dialogue garde le focus, les cibles de navigation font 44 px et la page s’adapte à la largeur mobile. Un seul canvas et un seul worker sont utilisés par lecteur, quelle que soit la longueur du document.

La préparation et les pannes sont visibles. En cas d’échec de lecture, le PDF déjà produit reste téléchargeable et le retour au formulaire reste possible. Le test réseau a trouvé un second défaut : le repli global de PDF.js mémorisait un échec de worker, rendant **Réessayer** inefficace même après retour du réseau. Chaque aperçu utilise désormais son propre worker, avec attente bornée et destruction explicite. La fermeture révoque le Blob URL, interrompt le rendu et détruit worker/document ; une génération terminée après fermeture ne rouvre pas le lecteur. Le chargement d’un logo ne peut plus bloquer la génération indéfiniment (8 secondes maximum).

### Défauts de pagination corrigés

- Les coordonnées d’entreprise et client sont maintenant renvoyées à la ligne dans leur largeur ; un bloc client trop haut se poursuit sur la page suivante.
- Objet, mentions et conditions vérifient la place disponible pour chaque ligne. Une seule désignation dépassant une page est répartie sur plusieurs pages avec en-tête de tableau répété, et quantité/prix/montant imprimés une seule fois pour la prestation.
- La place des totaux tient compte du nombre de taux de TVA. Le calcul, les mentions comptables, les CGV et la signature après les CGV sont conservés.
- Un logo vertical est borné en hauteur ; une raison sociale longue ne fait plus déborder le pied de page ni chevaucher la pagination. Seul le rappel de pied est abrégé, l’identité complète reste dans l’en-tête.

### Preuves de la reprise

Compétence PDF lue et annoncée. Poppler n’étant pas présent dans cet environnement, les PDF réels ont été rendus en PNG avec le moteur PDF.js utilisé par le lecteur, puis inspectés visuellement. Un devis court et un devis fictif de **12 pages** sont conservés dans les résultats, avec les 12 rendus pleine page du document long. L’inspection couvre l’en-tête et les coordonnées longs, la continuation de la prestation, le tableau de 46 lignes, les totaux, les conditions longues, les CGV et le cadre de signature. Aucun texte hors page ou chevauchement n’a été relevé. Le PDF long conserve **1 000,00 € HT + 144,00 € TVA = 1 144,00 € TTC**, avec un unique total TTC et tous les marqueurs de fin de texte attendus.

`tests/artisan-devis-apercu-audit.spec.ts` ajoute quatre scénarios, exécutés sur ordinateur et mobile :

1. Aperçu sans téléchargement ni mutation, pixels PDF réellement rendus, zoom, vue texte, téléchargement explicite, fermeture clavier/focus, révocation URL et nouvelle génération après correction du prix.
2. Reprise d’un brouillon long, navigation, rendu de toutes les pages, contrôle des coordonnées du texte par le parseur réel, intégrité des derniers mots, montants et signature, puis retour aux 46 lignes intactes.
3. Worker indisponible, message explicite, téléchargement de repli, rétablissement du réseau et nouvelle tentative réussie, sans perdre le formulaire.
4. Fermeture pendant chargement du logo, maintien des saisies, réouverture saine et un seul worker lancé pour le lecteur conservé.

**54/54 cas UI devis/documents passent**, dont les **8 nouveaux cas d’aperçu** (ordinateur et mobile, 1 min 12 s). **50/50 tests unitaires devis/documents**, TypeScript, ESLint ciblé et `git diff --check` passent également. Les tests utilisent uniquement les API fictives : aucun email réel, upload de production, signature ni migration. Les preuves initiales sont sous `test-results/audit-devis-apercu/`; le rejeu complet et les PDF/PNG finaux sont sous `test-results/audit-documents-apercu-final/`.

Limites : les polices PDF restent celles du générateur existant ; les alphabets hors de leur couverture et les PDF scannés/OCR ne sont pas validés ici. Le texte accessible est celui de la page sélectionnée ; le PDF téléchargé n’est pas rendu conforme PDF/UA par ce changement. Le numéro définitif d’un nouveau devis est toujours attribué côté serveur lors de l’enregistrement.

### Stabilisation du serveur de test partagé

La validation globale a signalé un échec de DOC-17 mobile, après les 54 cas ciblés verts. La trace établit une **recharge complète de la page**, pas un échec métier du retry : le 8 novembre à 11:19:02, un événement `beforeunload` précède une nouvelle requête document sur la même URL et une reconnexion Vite. Le formulaire avait reçu les deux réponses 503 attendues ; il a disparu avant que le clic Enregistrer soit exécuté. Des rapports Markdown étaient sauvegardés simultanément sur le serveur de développement partagé.

Le helper commun `installerBackendArtisan` neutralise désormais uniquement le WebSocket HMR local `ws://127.0.0.1:5180/**`, comme le faisaient déjà les suites suivi et métrés. Les requêtes applicatives, les erreurs et toutes les assertions restent inchangées ; aucun code produit n’a été modifié pour cet incident. Rejeu DOC-17 après correction : **5/5 répétitions mobiles et 3/3 desktop réussies**, ESLint du helper et contrôle du diff réussis. Preuves : `test-results/audit-doc17-hmr/` et `test-results/audit-doc17-hmr-desktop/`.
