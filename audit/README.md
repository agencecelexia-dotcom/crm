# Audit complet du CRM Celexia — synthèse

**Date** : 3 août 2026 · **Périmètre** : intégralité du dépôt (18 476 LOC front, 60 migrations SQL, edge function, intégration n8n, configuration de déploiement) · **Méthode** : lecture de code exhaustive + exécution réelle de `tsc`, `eslint`, `vite build` et `npm audit` après `npm install`.

**Cet audit n'a modifié aucun fichier applicatif.** Les seules écritures sont dans ce dossier `audit/` et dans `node_modules/`.

---

## Le constat en cinq lignes

Le CRM est parti d'un outil interne pour deux associés (4 migrations, RLS simple) et est devenu, en 56 migrations, une application avec **quatre pages publiques non authentifiées**, un espace artisan, un générateur de devis, des automatisations planifiées et un webhook sortant — **sans que le modèle de sécurité initial soit jamais revu**. Le code lui-même est de bonne facture : il compile et lint sans une seule erreur, ne contient aucun `any`, et son architecture par features est cohérente. Les défauts ne sont pas dans l'écriture du code, ils sont dans **ce qui n'a pas été ajouté au fur et à mesure** : des garde-fous côté serveur, des tests, une CI, des en-têtes HTTP, et une révision de qui peut faire quoi.

Deux défauts touchent directement le modèle économique : **le taux de commission signé au contrat n'est jamais celui qui est facturé**, et **le montant d'un devis signé ne remonte à la commission que par un chemin détourné**. Ce sont, en euros, les points les plus coûteux de ce rapport.

---

## Vue d'ensemble

**79 findings** répartis sur six domaines.

| Sévérité | Nombre | Signification |
|---|---:|---|
| 🔴 **CRITIQUE** | **9** | Exploitable à distance sans authentification, ou perte d'argent silencieuse |
| 🟠 **ÉLEVÉ** | **25** | Exploitable sous condition raisonnable, ou incohérence métier visible |
| 🟡 **MOYEN** | **30** | Nécessite un enchaînement, ou impact circonscrit |
| ⚪ **FAIBLE** | **15** | Durcissement, dette, hygiène |

| Rapport | Domaine | 🔴 | 🟠 | 🟡 | ⚪ |
|---|---|---:|---:|---:|---:|
| [01-securite-base.md](./01-securite-base.md) | RLS, RPC exposées à `anon`, tokens, storage, edge function | 4 | 5 | 4 | 2 |
| [02-securite-app.md](./02-securite-app.md) | Front, n8n, dépendances, en-têtes HTTP, **RGPD** | 2 | 6 | 7 | 2 |
| [03-logique-metier.md](./03-logique-metier.md) | Commission, montants, statuts, affectations, cron | 2 | 4 | 4 | 2 |
| [04-qualite-code.md](./04-qualite-code.md) | Architecture, erreurs, react-query, typage | 1 | 3 | 5 | 3 |
| [05-build-tests-ci.md](./05-build-tests-ci.md) | Build, tests, CI, migrations, documentation | 0 | 4 | 5 | 3 |
| [06-perf-ux-a11y.md](./06-perf-ux-a11y.md) | Bundle, N+1, pagination, mobile, accessibilité | 0 | 3 | 5 | 3 |

📄 [**verification-prod.sql**](./verification-prod.sql) — script **100 % lecture** à coller dans le SQL Editor Supabase. Il tranche ce que le code seul ne peut pas établir. **À lancer en premier.**

---

## Les 9 findings critiques

| # | Finding | Impact en une phrase | Effort |
|---|---|---|---|
| [A1-01](./01-securite-base.md) | Bucket `devis` public, ouvert en écriture **et suppression** à `anon` | N'importe qui peut lister, télécharger, écraser et supprimer tous les devis PDF — qui contiennent les coordonnées des clients. | M |
| [A1-02](./01-securite-base.md) | 8 fonctions `SECURITY DEFINER` sans `GRANT` → `EXECUTE` ouvert à `PUBLIC` | `anon` peut appeler `traiter_relances()` en boucle et déclencher des envois d'emails en masse, lire les statistiques de l'agence, écrire dans `taches`. | S |
| [A1-03](./01-securite-base.md) | Tokens porteurs permanents, non révocables, qui en révèlent d'autres | Un artisan écarté conserve un accès complet aux PII des clients. Aucun moyen de couper un lien transmis par erreur. | M |
| [A1-04](./01-securite-base.md) | `inscrire_artisan` : écriture anonyme non validée, non limitée en débit | Insertion arbitraire dans `artisans`, un email envoyé à chaque appel, et maîtrise du taux de commission par l'appelant. | M |
| [A2-01](./02-securite-app.md) | **Webhook n8n = relais de messagerie ouvert** | N'importe qui fait envoyer, depuis `agence.celexia@gmail.com`, un email arbitraire avec pièce jointe au destinataire de son choix. Phishing, quota Gmail, réputation du domaine. | M |
| [A2-02](./02-securite-app.md) | jspdf en version critique (10 advisories) | Injection d'objets PDF atteignable via les saisies libres des artisans, dans des documents contractuels envoyés aux clients. | M |
| [A3-01](./03-logique-metier.md) | **Le taux du contrat n'est jamais appliqué à la facturation** | Artisan recruté à 15 % : contrat à 15 %, CRM facture 10 %. **Sur un devis de 20 000 €, 1 000 € perdus par chantier.** Dans l'autre sens, sur-facturation contraire au contrat signé. | M |
| [A3-02](./03-logique-metier.md) | Le montant du devis signé ne remonte pas à la commission | Un artisan qui dépose son devis sans déclarer le statut laisse la commission à **0 €**. Elle n'est pas mal calculée : elle est invisible, donc jamais réclamée. | S |
| [A4-01](./04-qualite-code.md) | Aucun ErrorBoundary : une valeur inattendue blanchit toute l'app | Sur une **page publique de signature de contrat**, l'artisan voit un écran blanc, sans message ni recours. | S |

---

## Plan de remédiation

Ordonné par ratio impact/effort. Les trois vagues sont indépendantes : la première peut être appliquée sans attendre que le reste soit décidé.

### Vague 1 — Aujourd'hui (une demi-journée à deux)

Ferme les accès ouverts et les fuites. Aucune de ces actions ne demande de refactor.

| Action | Où | Effort |
|---|---|---|
| **Lancer [`verification-prod.sql`](./verification-prod.sql)** et me renvoyer le résultat | SQL Editor Supabase | 5 min |
| **Désactiver l'inscription libre** Supabase (*Authentication → Providers → Email → Enable sign-ups*) — si elle est ouverte, n'importe qui obtient un accès total (A1-08) | Dashboard | 2 min |
| **Fermer les `EXECUTE` ouverts à `PUBLIC`** — une migration, aucun changement applicatif | [A1-02](./01-securite-base.md) | S |
| **Passer les buckets `devis` et `projet-photos` en privé** et restreindre les policies | [A1-01](./01-securite-base.md), [A1-07](./01-securite-base.md) | M |
| **Authentifier le webhook n8n** (Header Auth) et verrouiller le nœud Code | [A2-01](./02-securite-app.md) | M |
| **`npm audit fix`** puis `npm i jspdf@^4.2.1` et vérifier le rendu des PDF | [A2-02](./02-securite-app.md), [A2-05](./02-securite-app.md) | M |
| **Poser les en-têtes de sécurité** dans `vercel.json` — `Referrer-Policy: no-referrer` ferme la fuite de token vers Google Fonts | [A2-03](./02-securite-app.md) | S |
| **Supprimer l'edge function `upload-devis`** — service_role + CORS `*`, et jamais appelée | [A1-06](./01-securite-base.md) | S |

### Vague 2 — Cette semaine

Répare l'argent et rend les pannes visibles.

| Action | Où | Effort |
|---|---|---|
| **Trigger de synchronisation du montant** `affectations` → `projets` | [A3-02](./03-logique-metier.md) | S |
| **Propager le taux de commission de l'artisan au projet**, + requête de diagnostic des dossiers déjà facturés | [A3-01](./03-logique-metier.md) | M |
| **Borner les montants et les taux** côté serveur et par contraintes `check` | [A1-09](./01-securite-base.md), [A3-03](./03-logique-metier.md), [A3-07](./03-logique-metier.md) | S |
| **ErrorBoundary + `statutInfo()` + page 404** | [A4-01](./04-qualite-code.md), [A4-05](./04-qualite-code.md), [A3-06](./03-logique-metier.md) | S |
| **`queryClient.clear()` à la déconnexion** — trois lignes | [A4-02](./04-qualite-code.md) | S |
| **Découpage du bundle par route** — 523,6 kB bruts / 155,6 kB gzip retirés du chargement initial, chiffre mesuré | [A6-01](./06-perf-ux-a11y.md) | S |
| **Corriger le contraste des badges de statut** — 8 couleurs sur 10 échouent WCAG AA | [A6-02](./06-perf-ux-a11y.md) | S |
| **Poser la CI GitHub Actions** (workflow prêt à coller en annexe) + protection de branche | [A5-01](./05-build-tests-ci.md) | S |
| **Révocation des tokens** — colonne `token_revoked_at` + `revoquer_acces_artisan()` | [A1-03](./01-securite-base.md) | M |
| **Messages d'erreur génériques sur les pages publiques** | [A2-04](./02-securite-app.md) | M |

### Vague 3 — Ce trimestre

Structure et conformité.

| Action | Où | Effort |
|---|---|---|
| **Tests pgTAP sur la RLS et les grants** — le meilleur rapport valeur/effort du rapport ; ils auraient attrapé A1-01 et A1-02 | [A5-02](./05-build-tests-ci.md), annexe B | M |
| **Session Playwright authentifiée** + les 10 parcours prioritaires | [A5-02](./05-build-tests-ci.md), annexe B | L |
| **Éléments de preuve de signature** (IP, user-agent, hash du contenu signé) | [A2-14](./02-securite-app.md) | S |
| **Page de confidentialité + exercice des droits** (export / effacement) | [A2-15](./02-securite-app.md) | M |
| **Politique de conservation** par anonymisation planifiée | [A2-13](./02-securite-app.md) | M |
| **Journal d'audit des accès aux PII** — indispensable pour notifier une violation sous 72 h | [A2-16](./02-securite-app.md) | M |
| **Pagination serveur + colonnes explicites** sur les listes | [A6-03](./06-perf-ux-a11y.md) | M |
| **Génération des types Supabase** + `createClient<Database>` | [A4-09](./04-qualite-code.md) | M |
| **Fabrique de clés react-query** puis migration progressive | [A4-03](./04-qualite-code.md) | M |
| **Consolidation des migrations** (fonctions redéfinies jusqu'à 10×) + `supabase/config.toml` versionné | [A1-14](./01-securite-base.md), [A5-04](./05-build-tests-ci.md) | M |
| **Mise à jour du README** — 4 écarts documentés entre la doc et la réalité | [A5-03](./05-build-tests-ci.md) | S |
| **Découpage de `espace-artisan-page.tsx`** (987 l.) — de préférence à l'occasion d'une évolution fonctionnelle, et après la CI | [A4-06](./04-qualite-code.md) | M |

---

## Deux avertissements sur l'ordre des corrections

**A3-01 et A3-03 doivent être traités ensemble.** Aujourd'hui, un artisan peut s'inscrire avec `taux_commission = 0` en appelant directement la RPC (A3-03), mais l'impact financier est neutralisé par le fait que `projets.taux_commission` reste à 0,10 quoi qu'il arrive (A3-01). **Corriger A3-01 seul transformerait une faille latente en perte immédiate.** Poser d'abord la contrainte `check` sur le taux, puis brancher la propagation.

**Le job `audit` de la CI échouera à sa première exécution**, à cause de jspdf et react-router. C'est voulu : corriger les dépendances (vague 1) avant de poser la CI (vague 2), et surtout ne pas abaisser `--audit-level` pour faire passer le job.

---

## Ce que le code seul ne permet pas de trancher

Cinq points dépendent de l'état réel de la production. [`verification-prod.sql`](./verification-prod.sql) les couvre tous.

| Question | Pourquoi c'est déterminant |
|---|---|
| **Combien de comptes existent dans `auth.users` ?** | Toutes les policies sont `to authenticated using (true)`. Tout compte lit et écrit l'intégralité de la base. **Un nombre supérieur à 2 est à traiter immédiatement.** |
| Quelle est l'ACL réelle des fonctions `SECURITY DEFINER` ? | Confirme ou infirme A1-02. Une valeur `acl` à `NULL` = `EXECUTE` ouvert à `PUBLIC`. |
| Les buckets `devis` et `projet-photos` sont-ils réellement `public = true` ? | Confirme A1-01 et A1-07. |
| Les 60 migrations ont-elles toutes été appliquées, et dans l'ordre ? | Le README recommande de les coller à la main dans le SQL Editor. C'est probablement l'origine des `grant` manquants. |
| Existe-t-il des taux de commission divergents et des montants non remontés ? | Mesure l'ampleur financière déjà réalisée de A3-01 et A3-02, plutôt que son ampleur potentielle. |

Deux vérifications complémentaires, hors script : la **région d'hébergement Supabase** (Settings → General → Region), et le réglage **`verify_jwt`** de l'edge function — non épinglé faute de `supabase/config.toml` versionné.

---

## Ce que le projet fait bien

Un audit qui ne relève que les défauts donne une image fausse et rend les priorités illisibles. Ces choix sont corrects et doivent être **préservés** pendant les corrections.

**Code et outillage**
- `tsc` et `eslint` passent **sans une seule erreur** sur 18 476 lignes, sans aucune CI pour l'imposer. C'est de la discipline.
- **0 `any`, 0 `@ts-ignore`, 1 seul `eslint-disable`** dans tout le dépôt.
- `tsconfig.app.json` va au-delà des réglages par défaut : `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
- Le découpage par `features/` est cohérent et tenu sur 14 modules ; les 12 fichiers de hooks suivent le même patron.
- Le build est rapide et fiable : 3,05 s pour 4 048 modules.

**Sécurité**
- La RLS est activée sur **les 14 tables**, sans exception, en 60 migrations.
- **Aucune page publique ne fait de `.from()` direct** : tout l'accès anonyme passe par des RPC, ce qui donne un point de contrôle unique et auditable. L'architecture est la bonne — ce sont les fonctions qui sont trop permissives.
- Le bucket `documents` est correctement conçu (privé, URLs signées 1 h) : le patron sûr est déjà implémenté dans le projet.
- **Aucune clé de service n'a jamais été commitée**, sur l'intégralité de l'historique git.
- Toutes les fonctions `SECURITY DEFINER` figent leur `search_path`.
- `get_espace_artisan` masque les PII client tant que le contrat n'est pas signé — une minimisation délibérée.
- Aucun `dangerouslySetInnerHTML`, `innerHTML` ni `eval` dans tout `src/`.

**Métier**
- La commission est une **colonne générée par la base**, jamais recalculée en JavaScript. L'architecture est juste ; ce sont ses entrées qui sont mal alimentées.
- La séparation `projets` / `affectations` est la bonne modélisation pour le multi-artisans.
- Le trigger `auto_statut_sur_devis` ne rétrograde jamais un statut plus avancé.

**Mobile**
- La barre de navigation est exemplaire : cibles de 56 px, gestion de l'encoche, libellés textuels, `aria-label`.
- Les claviers contextuels sont correctement déclarés partout (`type="tel"`, `inputMode="decimal"`…).
- Le pad de signature gère proprement le tactile (pointer events, `touchAction: 'none'`).
- Le chargement différé est déjà maîtrisé sur les PDF : **2,3 Mo tenus hors du chemin critique**.
- Le géocodage respecte scrupuleusement la politique d'usage de Nominatim.

---

## Méthode et limites

**Ce qui a été fait** : lecture intégrale des 60 migrations, des 4 pages publiques, des 12 fichiers de hooks, de l'edge function, du nœud n8n et de toutes les configurations. Exécution réelle de `npm install`, `tsc -b --noEmit`, `eslint .`, `npm run build`, `npm audit`. Calcul des ratios de contraste selon la formule WCAG 2.1.

**Ce qui n'a pas pu être fait**, et les conclusions qui en dépendent sont marquées comme telles dans chaque rapport :
- **L'application n'a pas été lancée** — pas de `.env.local`, donc pas de session Supabase. Les temps de chargement et les Core Web Vitals de `06-perf-ux-a11y.md` sont des **estimations dérivées des tailles mesurées**, jamais des mesures Lighthouse.
- **La base de production n'a pas été interrogée.** Tout ce qui dépend de son état réel est marqué « à confirmer » et couvert par `verification-prod.sql`.
- **Les tests Playwright n'ont pas été exécutés** (ils requièrent un serveur et des identifiants).
- `rafraichir_taches` n'a pas été lue dans ses trois versions : `03-logique-metier.md` (A3-09) ne conclut donc pas sur son idempotence réelle.

**Sur le volet juridique** : `02-securite-app.md` décrit des risques de conformité RGPD et eIDAS. Ce n'est pas un avis juridique. Les points sensibles — valeur probante des signatures, durées de conservation, registre des traitements — doivent être validés par un conseil.
