# Audit artisan — suivi, étapes, urgences et reprises

Date : 8 novembre 2026. Les constats et références de la première partie décrivent les sources **avant les correctifs de cette mission**. Le bilan en fin de document distingue les corrections validées et les limites restantes. Périmètre : espace public `/artisan/:token`, fiche chantier, liste/kanban, suivi, appels, rendez-vous, rappels, attente, perte/retrait/restauration, contrat, KPI associés et dernières définitions SQL du dépôt.

## Méthode et limites

- Lecture des composants et des migrations jusqu’à `0183_metre_ia_traces.sql`. « SQL effectif » désigne ici la dernière définition résultant de leur ordre dans le dépôt, **pas une vérification des fonctions actuellement déployées**.
- Aucune lecture de secrets, connexion à la base réelle, application de migration distante, modification de compte, message à un artisan ou mutation métier réelle.
- Tests navigateur contre `127.0.0.1:5180`, API exclusivement simulées sur `https://crm-test.supabase.co/rest/v1/rpc/...`. Chaque interception spécifique est installée au niveau `page` avant le helper commun au niveau contexte. Les données sont fictives.
- Les interactions SQL étaient initialement des constats de source. Elles ont ensuite été testées avec les vraies migrations et fonctions PostgreSQL dans PGlite, local et jetable, avec fixtures annulées en fin de transaction. Les services Supabase, cron et HTTP sont simulés ; la base métier, les contraintes et triggers sont exécutés. Une réponse RPC simulée dans le navigateur ne constitue pas cette preuve SQL.
- Les reproductions connues utilisaient temporairement `test.fail()` / `it.fails()`, avec une assertion sur le comportement attendu. Tous ces marqueurs ont été retirés après correction ; les tests sont désormais ordinaires.

## Carte des sources de vérité

| Objet | Écriture effective repérée | Lecture et consommation |
|---|---|---|
| Statut courant | `0156:add_suivi_by_token`, lignes 478–592 | `SuiviArtisan.statutActuel`, badges et filtres de liste |
| Étape / issue | `0118:appliquer_etape`, `0077:trg_maj_etape_issue`, garde `0121:trg_coherence_issue` | Kanban, urgences, fermeture visuelle, KPI |
| Pause | `0156:add_suivi_by_token`, lignes 524–536 : **en_attente_depuis uniquement** | Champ renvoyé par l’espace, non consommé par le suivi initial |
| Rappel | `0156:definir_rappel_by_token`, lignes 97–126 | Suivi + urgences ; RPC garde une tolérance d’une journée pour la date |
| Rendez-vous | `0156:add_suivi_by_token`, lignes 538–548 | `date_rdv` pour les urgences ; texte historique pour le suivi initial |
| Appels | `0156:log_appel_by_token`, lignes 128–157 | Ajout à `suivis`, sans changement d’étape ni rappel daté |
| Retrait | `0156:retirer_chantier_by_token`, lignes 329–417 | Archives immédiates, motif et justification structurés |
| Restauration | `0156:restaurer_chantier_by_token`, lignes 419–476 | Statut remis à `artisan_assigne`, autres axes indirectement entretenus par triggers |
| KPI artisan | Dernière définition `0087:stats_artisan_faits`, lignes 21–146 | `TableauDeBordArtisan` ; périmètre de toutes les affectations hors projets supprimés |
| Espace | Dernière définition `0156:get_espace_artisan`, lignes 594–789 | Projets actifs et archives ; contrat / coordonnées masquées côté SQL |
| Protection abandon | `0077:peut_abandonner_affectation` et `trg_garde_fou_abandon`, lignes 63–116 | Retrait traduit plusieurs refus ; perte via suivi les rend génériques |
| Protection générale du jeton | `0156:acces_par_jeton`, lignes 25–51 | Artisan écarté / affectation retirée ; aucun contrôle de signature du contrat |

Le modèle comporte trois notions distinctes : **étape commerciale**, **issue de l’affaire**, **pause/rappel**. L’UI et les RPC ne les utilisent actuellement pas toutes de la même manière.

## Constats prioritaires

### SUIVI-01 / SUIVI-02 — P1 — La mise en attente ne se voit pas et la reprise à la même étape ne fonctionne pas

- Sources : `src/features/contrats/suivi-artisan.tsx:37`, `:471–480` ; `corps-chantier.tsx:111–120` ; `0156_jetons_cloisonnes.sql:524–536`.
- Reproduction : ouvrir un chantier `contacte`, cliquer **En attente**, laisser le serveur retourner `{ok:true,sous_statut:'en_attente'}` en conservant `statut='contacte'` et en posant `en_attente_depuis`. Le bouton reste `aria-pressed=false`. Recliquer l’étape active ne fait rien (`else if (!active)`), alors que déclarer cette même étape permettrait de lever la pause côté serveur.
- Impact : succès trompeur, clics répétés ajoutant des suivis inutiles, aucun repère pour les chantiers en pause, reprise inutilement obligée de changer d’étape.
- Proposition : transmettre et afficher le drapeau réel, distinguer « Mettre en attente » / « Reprendre le suivi », conserver l’étape, rendre l’action idempotente.
- Couverture avant correction : deux reproductions UI attendues en échec.

### SUIVI-03 — P1 — Annuler une signature ne demande pas confirmation

- Sources : `suivi-artisan.tsx:101–123`, `0118_correction_statut_artisan.sql:138–165`, `0121_devis_suit_letape.sql:63–85`.
- Reproduction : chantier `devis_signe`, montant signé 8 200 €, cliquer **Devis envoyé**. La requête part immédiatement : la confirmation couvre le passage à signature/terminé et le retour *avant le devis*, mais pas signature → devis envoyé.
- Impact : effacement potentiel du montant et document signés, sortie de `issue=gagne`, variation de CA/commission sans avertissement. Les règles comptables ne doivent pas être déduites du seul rang visuel.
- Proposition : confirmer explicitement chaque sortie de signature, montrer le montant signé, bloquer côté base une rétrogradation avec commission encaissée ou preuve signée selon les garde-fous autorisés.
- Couverture : reproduction UI ; effets SQL déduits des triggers, non exécutés sur base.

### SQL-01 — P1 — Régression de la date de réception : l’artisan paraît en retard avant d’avoir reçu le dossier

- Sources : `0093_recu_le_chronologie_artisan.sql` corrigeait la date d’attribution ; `0156_jetons_cloisonnes.sql:653` remet `recu_le=p.created_at`. Archives : `0156:744` conserve bien `coalesce(af.created_at,p.created_at)`.
- Reproduction : projet créé le 1er octobre, attribué à l’artisan le 8 novembre. L’espace actif dit « reçu il y a 1 mois », produit « jamais contacté » et trie le dossier parmi les anciens.
- Impact : fausses urgences, ordre trompeur, contradiction actif/archive.
- Proposition : utiliser `af.created_at` pour les deux listes, et la même origine pour les délais/KPI « reçu par l’artisan ».
- Couverture : lecture de la dernière migration ; test local SQL à ajouter à la validation d’intégration.

### SQL-02 — P1 — La restauration remet le statut à zéro tout en conservant l’ancienne étape

- Sources : `0156:449–454`, `0118:appliquer_etape`, `0121:trg_coherence_issue`.
- Reproduction : perdre/retirer un chantier à `etape=devis_envoye`, puis le reprendre. La RPC pose `statut=artisan_assigne`, mais ne réconcilie pas `etape`, `rappel_le`, `date_rdv`, les motifs ou `recontacter_le`. Le trigger de cohérence peut détacher le devis parce que le nouveau statut est antérieur au devis ; le kanban peut pourtant garder l’étape « Devis envoyé ».
- Impact : reprise incohérente, possible perte de lien/montant de devis, retour d’anciennes urgences. Cas des chantiers signés masqués : l’interaction avec la contrainte d’étape mérite une transaction locale spécifique.
- Proposition validée pour la phase corrective : **reprendre l’étape conservée**, conserver les devis et l’historique, nettoyer uniquement les rendez-vous/rappels périmés et la qualification de perte, contrôler l’attribution en verrouillant le projet. Pas de correction automatique destructive des dossiers existants.
- Couverture : source SQL et revue des triggers ; pas de preuve d’exécution réelle à ce stade.

### SQL-03 — P1 — Les RPC de suivi ne vérifient pas la signature du contrat

- Sources : `0156:acces_par_jeton` vérifie uniquement écarté/retiré ; `get_espace_artisan:646` renvoie les tokens d’affectation avant signature ; `add_suivi`, `definir_rappel`, `log_appel`, `restaurer` n’ajoutent pas de garde contractuelle.
- Reproduction de source : avec le token d’affectation fourni avant signature, appeler l’une de ces RPC. L’UI courante cache les actions, mais la fonction n’exige pas de contrat signé/externe.
- Impact : la restriction affichée n’est pas garantie à la frontière serveur.
- Proposition : garde commune contrat signé/externe, artisan actif, affectation/projet valides. Conserver le retrait volontaire avant signature, explicitement prévu par le produit, tout en protégeant les modifications métier.
- Couverture : la fiche courante est testée non signée ; refus SQL à tester sur base locale. Aucune tentative réelle effectuée.

### SUIVI-04 — P1 — Une nouvelle note peut être perdue pendant l’envoi de la précédente

- Sources : `suivi-artisan.tsx:133–153`, `:549–554`.
- Reproduction : saisir A, envoyer avec réseau lent, saisir B pendant que l’envoi reste en cours, laisser A réussir. `setNote('')` efface aussi B ; le textarea n’était pas désactivé.
- Impact : perte silencieuse d’une note non transmise.
- Proposition : conserver B si elle diffère du texte soumis, ou désactiver l’édition pendant l’envoi ; verrou synchrone des actions pour les événements rapprochés.
- Couverture : reproduction UI attendue en échec, plus test double clic pendant requête.

### SUIVI-07 — P1 — Les archives affichent des échanges avant signature

- Sources : `drawer-chantier-perdu.tsx:111–176`, `0156:get_espace_artisan:681–689,748–760`.
- Reproduction : contrat non signé, dossier perdu contenant une note agence avec téléphone/adresse. Le titre dit « Client confidentiel », mais ouvrir le dossier affiche le message et les devis.
- Impact : confidentialité incohérente et documents potentiellement identifiants accessibles dans un écran censé les verrouiller.
- Proposition : masquer historique/documents client avant signature dans l’UI **et** dans la réponse RPC ; conserver les informations nécessaires pour accepter/refuser un chantier, selon le périmètre des pièces volontairement partagées.
- Couverture : reproduction UI attendue en échec sur message fictif.

## Autres incohérences et défauts d’usage

| Référence / gravité | Reproduction et impact | Proposition / couverture |
|---|---|---|
| SUIVI-05, P2 — RDV canonique invisible | `date_rdv` existe, mais aucun suivi texte RDV (import/agence). Le suivi n’affiche ni date ni heure, car il ne lit que `suivis.message` (`suivi-artisan:77`). Le formulaire n’est pas prérempli. | Transmettre `date_rdv`, l’afficher avec fuseau, préremplir modification ; UI en échec attendu. |
| SUIVI-06, P2 — Refus financier de perte opaque | La base renvoie `abandon_refuse:commission_encaissee`, le suivi affiche seulement « Impossible d’enregistrer » (`:143–149`). | Traduire codes/raisons maîtrisés et maintenir raison saisie. UI en échec attendu. |
| SUIVI-08, P2 — Filtre signé puis kanban vide | Filtrer « Devis signé » sélectionne des dossiers, puis Par étape les élimine tous (`kanban-chantiers:48`). Même problème pour terminés/perdus, sans explication. | Faire porter le même périmètre à la liste et au kanban, ou annoncer explicitement une restriction et adapter les filtres. UI en échec attendu. |
| SUIVI-09, P2 — Restauration ferme le dossier avant réponse | `chantiers-perdus:199–201` appelle `setOuvert(null)` avant RPC. Refus/réseau = contexte perdu, pas de réessai dans la fiche. | Fermer seulement après succès ; conserver erreur/contexte. UI en échec attendu. |
| SUIVI-10, P2 — Nouveau et en retard simultanés | À 49 h, urgence dit « Jamais contacté (2 j) » mais `estNouveau` utilise `j<=2` et garde « Nouveau » jusqu’à 72 h. | Seuil unique exact 48 h. Test unitaire attendu en échec. |
| SUIVI-11, P2 — Rappel futur masqué par une ancienne urgence | Un devis ancien avec rappel dans une semaine garde « Devis sans réponse » car la règle du rappel futur arrive après (`urgence-chantier:102–120`). | Distinguer attente planifiée et retard ; conserver priorité d’un RDV réellement dépassé. Test unitaire attendu en échec ; règle produit à expliciter. |
| SUIVI-12, P2 — Hier présenté comme aujourd’hui | Réception/message la veille à 22 h, lecture le lendemain à 10 h : division par 24 h → « aujourd’hui ». | Comparaison des jours calendaires pour les labels, durées exactes pour les seuils. Test unitaire attendu en échec. |
| SUIVI-13, P3 — Date invalide visible comme NaN | `ancienneteLabel('date-invalide')` produit « il y a NaN mois ». | Valider la date, retour neutre. Test unitaire attendu en échec. |
| SUIVI-14, P3 — Recherche sensible aux accents | « emilie » ne trouve pas « Émilie ». | Normalisation diacritique, sans changer les données. Test unitaire attendu en échec. |
| KPI-01, P2 — Résumé et filtre À traiter divergent | Le résumé ne somme que rappels/48 h/devis15j (`tableau-de-bord:43`), le filtre frontend ajoute nouveaux et RDV passés. Cliquer « Voir ces chantiers » ne reproduit pas le groupe annoncé. | Calcul partagé depuis les dossiers effectivement visibles ; conserver les KPI financiers serveur. Couverture source, test ciblé à compléter. |
| KPI-02, P2 — Origine des délais erronée | `stats_artisan_faits0087:27` utilise création du projet comme réception : même décalage que SQL-01. | Date d’affectation pour réception→contact/devis. SQL source uniquement. |
| KPI-03, P2 — « dernière activité » n’est pas le dernier échange | `derniere_activite=af.updated_at`. Ajouter note/appel n’actualise pas l’affectation ; changer rappel la modifie. Des messages récents peuvent rester « Sans activité » et programmer un rappel rajeunit artificiellement un devis. | Horodatage défini par événement/activité pertinente ; éviter de prétendre mesurer le délai de réponse client avec une modification administrative. Source uniquement. |
| APPEL-01, P2 — Appel joint et rappel ont une sémantique ambiguë | « Je l’ai eu » journalise seulement, conserve « jamais contacté ». « À rappeler » journalise sans date ; un vrai rappel se programme ailleurs. | Nommer clairement la journalisation ou proposer étape/date dans le même flux ; ne pas promouvoir une étape financière implicitement. Tests payload + erreur/réessai couvrent le comportement actuel. |
| PERTE-01, P2 — Deux parcours de perte, une qualification incomplète | Le retrait impose motif normalisé + 5 caractères, « Pas de suite / Perdu » accepte n’importe quel texte non vide sans motif structuré. Les statistiques de motifs peuvent rester non qualifiées. | Une qualification cohérente, tout en conservant distinction refus artisan / perte client ; pas de requalification automatique des anciennes données. Source + UI validation raison. |
| RETRAIT-01, P2 — Confirmation mensongère | Dialogue dit « Cette action est définitive » et disparition de l’espace, mais archives/restauration sont prévues. | Dire sortie des chantiers actifs, possibilité de reprise si non réattribué ; maintenir confirmation motivée. Source. |
| RETRAIT-02, P2 — Promesse de recontact artisan non assurée | Texte « Le chantier vous sera resignalé » ; `0079:traiter_recontacts` crée une notification agence puis consomme la date, sans restauration ni message artisan. | Texte conforme au destinataire réel ; éventuelle notification artisan comme fonctionnalité distincte. Source uniquement. |
| RETRAIT-03, P2 — Date cachée encore envoyée | Choisir motif relançable + date, puis motif non relançable : le champ disparaît, `recontacterLe` reste envoyé. | Effacer/ignorer la date dès que le motif ne permet plus de recontact. Reproduction UI à compléter. |
| SQL-04, P2 — Restauration non idempotente/concurrente | RPC sans `FOR UPDATE` ni retour « déjà actif » ; plusieurs requêtes peuvent dupliquer notes/notifications, contrôle artisan_id et écriture ne sont pas atomiquement protégés. | Verrouiller projet/affectation dans un ordre cohérent, retourner succès sans réécriture si déjà actif. SQL local requis. |
| SQL-05, P2 — Même étape et reprise de pause | La déclaration identique efface la pause dans la RPC, mais certains effets ne se produisent que si `statut` change dans le trigger. Le comportement doit être explicite et idempotent. | Réconcilier les axes dans la RPC sans réinitialiser les faits valides. SQL local requis. |

## Couverture de comportement avant correction

Fichiers ajoutés : `tests/unit/artisan-suivi-audit.test.ts`, `tests/artisan-suivi-audit.spec.ts`.

- Unitaires : 12 cas, dont 7 comportements préservés et 5 anomalies documentées en échec attendu. Exécution initiale : **7 réussites + 5 échecs attendus**.
- UI : 22 scénarios, incluant attente/reprise, sortie de signature, confirmation/annulation, note erreur/réessai/saisie concurrente/double clic, les trois résultats d’appel en erreur puis succès, RDV obligatoire/annulation et date canonique, rappel erreur/retrait, perte justification/refus, retrait refus comptable, contrat non signé, archives, filtre kanban, restauration erreur/réessai/verrou d’envoi.
- Baseline navigateur desktop enregistrée : **13 réussites + 9 échecs attendus**, avant les correctifs applicatifs.
- Non couverts par simulation : ordre réel des triggers PostgreSQL, droits DB/grants effectifs, verrous concurrents, jobs cron, webhook n8n, livraison de mails, base déjà migrée, résultat de la migration sur de vrais dossiers. Aucun de ces points n’est déclaré validé par les tests UI.

## Plan de correction autorisé

1. Réconcilier le modèle visible : pause, étape, date RDV, urgence, filtres et kanban.
2. Sécuriser les écritures côté UI : confirmation des reculs financiers, messages métier, préservation des brouillons, actions en cours et annulations.
3. Corriger les archives : confidentialité, restauration conservant le contexte, avertissement exact.
4. Préparer `0184_artisan_suivi_coherent.sql` sans l’appliquer : contrat, réception, reprise conservant l’étape/devis, nettoyage des dates périmées, idempotence.
5. Transformer les échecs attendus corrigés en tests ordinaires et relancer desktop/mobile + unitaires, TS et ESLint ciblés.

Aucune règle financière ne doit être changée silencieusement. Aucune migration ne sera appliquée à la production dans cette mission.

## Bilan après correction

Sources locales stabilisées le 8 novembre 2026. Les références suivantes concernent la version corrigée ; les références précédentes restent celles de la baseline.

| Constats | Correction livrée | Preuve / limite |
|---|---|---|
| SUIVI-01/02, SQL-05 | Pause lue depuis `en_attente_depuis`, reprise sans inventer une étape, actions identiques idempotentes. `suivi-artisan.tsx:514`, `0184_artisan_suivi_coherent.sql:140`. | UI desktop/mobile + assertions SQL pause/reprise. |
| SUIVI-03 | Confirmation de toute sortie de signature avec montant ; refus du recul si devis signé déposé ou commission encaissée, dans l’UI et les deux RPC de correction. `suivi-artisan.tsx:133`, migration 0184 fonctions `add_suivi_by_token` et `corriger_etape_by_token`. | Annulation sans requête, blocage avec justificatif, transactions SQL signé/payé et recul autorisé sans justificatif. Règles de calcul financier conservées. |
| SUIVI-04 | Verrou synchrone des actions, nouveau brouillon conservé pendant l’envoi de l’ancien, réessai après erreur. `suivi-artisan.tsx:161`. | Tests texte concurrent, double clic, erreur puis succès sur les deux viewports. |
| SUIVI-05/06 | Date/heure du RDV canonique, formulaire prérempli, erreurs métier explicites via `erreur-suivi.ts`. | RDV sans historique, date obligatoire, erreur conservant la sélection, succès et mise à jour d’étape ; refus financier lisible. |
| SUIVI-07, SQL-03 | Garde privée de contrat, artisan/affectation/projet valides ; archives sans historique ni PDF client avant signature dans UI et RPC. Retrait volontaire avant contrat maintenu, restauration protégée. `0184_artisan_suivi_coherent.sql:7`, `drawer-chantier-perdu.tsx`. | Tests UI contrat/archives et tests SQL de refus suivi/appel/rappel/correction/restauration ; retrait autorisé. Périmètre des documents agence volontairement partagés distinct. |
| SUIVI-08 | Même périmètre sélectionné en liste et kanban, y compris signé/terminé/perdu. `kanban-chantiers.tsx`. | Filtre « Devis signé » conservé lors du passage Par étape, desktop/mobile. |
| SUIVI-09, SQL-02/04 | Fiche conservée après refus ; verrou de soumission ; restauration de l’étape conservée et des devis/historique, retrait des dates périmées seulement. Verrous SQL sur affectation/projet et reprise déjà effectuée idempotente. | UI erreur/réessai/double clic ; SQL retour devis avec montants et URL conservés, dates expirées supprimées, dates futures conservées même à l’étape RDV, une seule note de reprise. Concurrence entre connexions distinctes non testée. |
| SUIVI-10 à 14 | Badge 48 h cohérent, rappel futur visible, pause explicite, jours calendaires pour « hier », dates invalides neutralisées, accents ignorés en recherche. `urgence-chantier.ts`, `dernier-suivi.ts`. | 12 tests unitaires ordinaires. |
| SQL-01, KPI-02 | Réception et délais à partir de la date d’affectation. `0184_artisan_suivi_coherent.sql:482`, `:604`. | SQL : projet ancien attribué aujourd’hui, absence de fausse urgence 48 h. |
| KPI-01 | Bandeau d’actions et filtre dérivés de la même fonction et des mêmes projets visibles ; pluriels corrigés. `tableau-de-bord-artisan.tsx`. | Revue de source et suites UI d’intégration ; calculs financiers restent ceux de la RPC. |
| KPI-03 | Dernière activité inclut désormais le dernier suivi/appel, via `greatest(af.updated_at, max(s.created_at))`. Migration 0184 lignes 483 et 605. | Un rappel modifie encore `updated_at` : cet indicateur mesure l’activité globale du dossier, pas la dernière réponse client. Voir limite ci-dessous. |
| APPEL-01 | « Journal des appels » et explication : journaliser ne change pas l’étape et ne programme pas de rappel daté. `suivi-artisan.tsx:403`. | Les trois issues d’appel testées en erreur puis réessai avec payload exact. Pas de promotion implicite de statut. |
| RETRAIT-01/02/03 | Confirmation conforme à la possibilité de reprise, destinataire Celexia du recontact annoncé, date supprimée/ignorée après motif non relançable, y compris côté RPC. | Scénario changement de motif/date cachée, confirmations/erreurs ; revue SQL du destinataire cron historique. |
| Libellés de clôture | KPI/filtre « Avant signature » ; dossiers signés non terminés dans « Travaux à suivre » ; autres clos dans « Terminés ou perdus » ; statut initial « À contacter ». `espace-artisan-page.tsx:329`, `:478`, `statut-artisan.tsx`. | Les travaux signés ne sont plus présentés comme terminés. Aucun calcul de chiffre d’affaires modifié. |

### Validation effectuée

- Unitaires : `npx vitest run tests/unit/artisan-suivi-audit.test.ts` — **12/12 réussis**.
- UI finale : **26 scénarios par viewport**, desktop et mobile. La passe de 52 cas a produit 51 réussites et un timeout initial de défilement/clic desktop sur « En attente » ; sa relance ciblée immédiate a réussi, sans modification de source ou d’assertion. Les 26 comportements ont donc réussi sur chacun des deux viewports. Une première passe corrigée des 22 cas initiaux avait également réussi intégralement sur desktop. Traces dans `test-results/audit-suivi-final` et `test-results/audit-suivi-retest`.
- Quatre scénarios ajoutés après la baseline : RDV erreur puis succès daté, rappel annulé puis programmé sans changer l’étape, date cachée retirée du payload de retrait, refus de recul avec document signé sans requête réseau.
- SQL : `npm run test:sql` exécute toutes les migrations en ordre et `supabase/tests/artisan_suivi_audit.sql`. Cette suite a réussi après 185 migrations lors de la vérification du périmètre suivi ; le coordinateur a ensuite confirmé **186 migrations et quatre suites SQL réussies**, incluant les autres périmètres de la mission. Tous les appels HTTP sont neutralisés dans ce banc.
- `npx tsc -b --noEmit`, ESLint ciblé et vérification d’espaces Git réussis. Les fixtures unitaires sont typées ; aucun `test.fail` / `it.fails` restant dans les deux suites suivi.

### Limites relevées avant PR83 — état historique

1. **PERTE-01 reste ouvert** : « Perdu » via suivi demande une justification, mais n’alimente pas les mêmes motifs normalisés que le retrait. Unifier les qualifications exige de préciser les catégories métier ; aucune requalification automatique d’anciens dossiers n’a été inventée.
2. **KPI-03 est partiellement corrigé** : une note récente n’est plus ignorée, mais l’étiquette « Devis sans réponse » repose toujours sur l’activité globale du dossier. Mesurer réellement l’absence de réponse client demande un événement/date dédiés, distincts d’un rappel ou d’une modification administrative.
3. Les verrous UI empêchent un double clic en cours ; les actions d’étape/restauration sont idempotentes côté SQL. Un réessai réseau indépendant de note/appel après réponse perdue n’a pas encore de clé d’idempotence persistante.
4. Le banc PostgreSQL exécute les fonctions/triggers réels, mais pas deux connexions concurrentes, les rôles et secrets Supabase réels, les jobs cron, n8n, le stockage ou la livraison d’emails. Il ne prouve ni les versions ni les droits effectivement déployés en production.
5. **Migration 0184 préparée, non appliquée à la production.** Les gardes contractuelles, la date d’affectation corrigée, la reprise cohérente et le masquage SQL nécessitent son déploiement. Le nouveau geste `reprendre` nécessite la RPC correspondante : coordonner le déploiement base et frontend. Aucune donnée existante n’a été migrée massivement ni aucun montant réel modifié.

## Reprise après publication de PR83 — notes, appels et pertes

Cette section décrit le lot suivant, préparé après la publication de PR83. Les états de déploiement ci-dessus sont ceux du bilan initial. **La migration 0189 a ensuite été publiée avec 0190, dans une transaction, après validation et sauvegarde des définitions serveur.** La migration 0184 déjà publiée n’a pas été modifiée. Le bilan global de cette reprise figure dans l’audit complet.

### Réponse perdue : une intention, un enregistrement

- `suivi-artisan.tsx:171` et `:258` transmettent une clé UUID avec la note, le changement de suivi ou l’appel. Le verrou immédiat de l’interface reste présent.
- `tentative-suivi.ts:13` conserve cette clé jusqu’à confirmation du succès. La clé de stockage est une empreinte SHA-256 de l’affectation, de l’action et de son contenu ; la valeur est seulement l’UUID. **Aucun jeton en clair, texte de note ou téléphone n’est conservé dans `sessionStorage`.** Le même envoi après rechargement réutilise la clé ; après succès, une nouvelle action volontairement identique en reçoit une nouvelle.
- `0189_suivi_idempotent_pertes_qualifiees.sql` ajoute un journal privé de reçus, avec RLS et droits directs retirés à `PUBLIC`, `anon` et `authenticated`. La clé est unique par affectation. Le journal contient l’empreinte, l’accusé contrôlé et sa date, pas une copie du texte client.
- Les deux nouvelles surcharges verrouillent **projet puis affectation**, contrôlent à nouveau l’accès après verrou, puis exécutent la fonction métier historique et enregistrent le reçu dans la même transaction. Même clé/même contenu : réponse initiale. Même clé/contenu différent, y compris note→appel : refus `idempotence_conflit`. Une erreur métier ne consomme pas la clé.
- Les tests ont révélé qu’une dernière perte peut clore le projet dans la transaction. Le helper privé `acces_accuse_suivi_par_jeton` autorise la relecture du seul accusé déjà validé après cette clôture. Le contrat, l’artisan actif et l’existence d’un projet non supprimé restent exigés. **Une nouvelle intention** sur chantier clos/retiré passe toujours par la garde d’écriture complète et reste refusée.

### PERTE-01 : qualification client explicite

Le parcours « Pas de suite / Perdu » exige désormais un motif et une précision d’au moins cinq caractères. Il propose les motifs client déjà définis dans le CRM : prix, budget, concurrent, injoignable, renoncement, aides et autre. Les motifs hors zone/métier/planning sont réservés au parcours de retrait indiqué dans le texte d’aide.

La nouvelle surcharge contrôle cette liste côté serveur, conserve `motif_perte`, `motif_perte_detail` et `origine_perte='client'`, puis garde la distinction avec le retrait : aucun `retire_at` n’est ajouté par cette action. Les garde-fous concernant un montant signé, un document signé ou une commission encaissée sont réutilisés sans modification. Aucun ancien dossier n’est requalifié automatiquement.

Le libellé KPI-03 est également corrigé dans `urgence-chantier.ts` et `tableau-de-bord-artisan.tsx` : l’indicateur annonce une absence de **mise à jour**, conformément à la date réellement mesurée, sans prétendre connaître la dernière réponse client.

### Preuves de validation de cette reprise

- **16 tests unitaires réussis** : 12 tests de suivi existants et 4 tests de tentative (clé conservée après rechargement du module, absence de texte privé dans le stockage, séparation des affectations/actions/contenus, nouvelle intention après succès, repli mémoire lorsque le stockage est interdit).
- **60 scénarios UI réussis : 30 desktop + 30 mobile**, API exclusivement fictive. Les quatre scénarios ajoutés couvrent note/appel validés côté serveur avec réponse perdue puis rechargement, nouvelle intention identique après succès, motifs client distincts du retrait, et serveur sans nouvelle surcharge refusant sans repli non protégé. Les tests existants vérifient encore annulations, erreurs, brouillon concurrent, contrat et garde-fous financiers. Traces : `test-results/suivi-reprise-final`.
- Le premier passage desktop avait rencontré une disparition du drawer pendant les sauvegardes parallèles sur Vite partagé. Le canal HMR local a été neutralisé dans cette seule suite ; aucune assertion métier n’a été retirée ni délai augmenté. La passe complète suivante a réussi.
- **189 migrations chargées dans PostgreSQL local**, suites `artisan_suivi_audit.sql` et `artisan_suivi_rejeu_audit.sql` réussies. La nouvelle suite vérifie le rejeu note/appel/perte, les conflits de clé, le cloisonnement par affectation, une nouvelle intention identique, le refus financier, le motif client et le retrait artisan, le contrat révoqué, les droits du journal et l’atomicité : un échec forcé d’écriture du reçu annule aussi la note.
- Typecheck global, ESLint ciblé et `git diff --check` réussis une fois les autres fichiers du travail parallèle stabilisés. Les résultats SQL/UI globaux du lot commun sont consignés par le coordinateur.

### Compatibilité et limites conservées

1. Appliquer 0189 et recharger le cache PostgREST **avant** le frontend. Les anciennes signatures sont conservées ; les nouvelles surcharges ont tous leurs arguments obligatoires pour éviter une résolution ambiguë. Sur une base non mise à jour, l’interface conserve la saisie et refuse l’enregistrement plutôt que de contourner la protection.
2. Les anciens onglets continuent d’utiliser les RPC historiques, sans cette déduplication ni qualification obligatoire. Le rechargement active le nouveau parcours. Aucune migration de masse n’est effectuée.
3. La clé du réessai est conservée pendant la session du navigateur. La fermeture définitive de cette session, l’effacement du stockage ou un autre appareil ne transportent pas automatiquement une intention antérieure. Si le stockage est interdit, la même page garde sa protection en mémoire mais ne peut la restaurer après rechargement.
4. La base conserve les reçus tant que l’affectation existe ; ils disparaissent avec sa suppression définitive. La concurrence réelle entre plusieurs connexions PostgreSQL n’a pas été exécutée dans PGlite ; l’ordre des verrous, la clé unique et les scénarios séquentiels d’entrelacement ont été vérifiés.
5. Les contraintes financières, notifications et règles historiques restent celles des fonctions déployées appelées par les surcharges. Aucun email réel, notification réelle, compte ou secret n’a été utilisé dans cette reprise.
