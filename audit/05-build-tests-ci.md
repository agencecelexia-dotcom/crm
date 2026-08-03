# A5 — Build, tests, CI & tooling

> Audit du 2026-08-03 · Node v24.18.1, npm 11.16.0, `npm install` exécuté.
> Toutes les sorties de commandes ci-dessous sont réelles et reproduites verbatim.

## Résumé

Le constat de départ est positif et mérite d'être posé avant les défauts : **le projet compile et lint sans une seule erreur, et le build de production réussit en 3 secondes** — sur 18 476 lignes, 60 migrations, et sans aucune intégration continue pour l'imposer. Rien n'oblige à ce niveau de propreté ; il est tenu à la main.

Le déficit est ailleurs, et il est net : **4 tests de fumée, tous sur des chemins non authentifiés, pour couvrir l'intégralité du produit**. Aucun test ne se connecte. Aucun test ne touche à un montant, une commission, une signature ou une affectation. Et aucune CI ne s'exécute avant un déploiement en production.

| Sévérité | Nombre |
|---|---|
| ÉLEVÉ | 4 |
| MOYEN | 5 |
| FAIBLE | 3 |

---

## Sorties de commandes

### `npx tsc -b --noEmit`

```
exit=0
(aucune sortie)
```

### `npx eslint .`

```
exit=0
(aucune sortie)
```

### `npm run build`

```
exit=0

> crm-celexia@0.1.0 build
> tsc -b && vite build

vite v7.3.5 building client environment for production...
✓ 4048 modules transformed.
dist/index.html                              2.07 kB │ gzip:   0.83 kB
dist/assets/pdf.worker.min-DEtVeC4l.mjs  1,255.07 kB
dist/assets/index-CduOLvqZ.css             111.44 kB │ gzip:  22.07 kB
dist/assets/purify.es-DSHCW8nm.js           26.22 kB │ gzip:   9.82 kB
dist/assets/vendor-query-DWZInx4z.js        36.21 kB │ gzip:  10.80 kB
dist/assets/vendor-react-DK-K0gij.js        49.58 kB │ gzip:  17.58 kB
dist/assets/vendor-map-BRoCYxZ4.js         153.97 kB │ gzip:  44.92 kB
dist/assets/index.es-Bkkz1SAn.js           159.01 kB │ gzip:  53.12 kB
dist/assets/html2canvas.esm-DXEQVQnt.js    201.04 kB │ gzip:  47.43 kB
dist/assets/vendor-supabase-BY7vTDRq.js    208.14 kB │ gzip:  54.42 kB
dist/assets/vendor-charts-Du07T8HK.js      369.66 kB │ gzip: 110.66 kB
dist/assets/jspdf.es.min-QlOHSGlu.js       385.21 kB │ gzip: 125.81 kB
dist/assets/vendor-pdf-BjAALUVx.js         431.65 kB │ gzip: 128.67 kB
dist/assets/index-Vp0lmbaI.js              885.10 kB │ gzip: 258.51 kB

(!) Some chunks are larger than 500 kB after minification.
✓ built in 3.05s
```

### `npm audit --omit=dev`

```
4 vulnerabilities (2 moderate, 1 high, 1 critical)
  jspdf        <=4.2.0                   critical  (10 advisories)
  react-router 6.0.0 - 8.2.0             high      (5 advisories)
  dompurify    <=3.4.11                  moderate  (4 advisories, transitif via jspdf)
```

Analyse d'exposition réelle en `02-securite-app.md` (A2-02, A2-05).

### `npm outdated` — écarts majeurs

```
jspdf             3.0.4  → 4.2.1    (majeure)
lucide-react    0.563.0  → 1.28.0   (majeure)
react-day-picker  9.14.0 → 10.0.1   (majeure)
@supabase/supabase-js    → 2.112.0
```

---

### [ÉLEVÉ] A5-01 — Aucune CI : rien ne s'exécute avant un déploiement en production

**Où** : absence de `.github/`, de `.husky/`, de `lint-staged` et de script `prepare`

**Constat** : vérifié — aucun de ces répertoires ni fichiers n'existe. Le déploiement repose sur l'intégration git de Vercel sur `main`. Il n'y a donc **aucune barrière** entre un `git push` et la production : ni type-check, ni lint, ni build de vérification, ni test, ni contrôle de vulnérabilités.

**Impact** : la propreté actuelle du code est un acquis fragile, tenu par la vigilance de deux personnes. Le jour où un commit casse la compilation, Vercel échouera à builder — c'est le seul filet, et il arrive tard, après le push, sans indication de la cause côté développeur. Pour un commit qui compile mais introduit une régression fonctionnelle, il n'y a strictement rien.

**Correctif** : le workflow complet est en annexe A. Il tient en un fichier et couvre type-check, lint, build et audit de sécurité. Le poser **avant** tout autre chantier de ce rapport : c'est ce qui empêchera les correctifs à venir d'introduire de nouvelles régressions.

**Effort** : S.

---

### [ÉLEVÉ] A5-02 — 4 tests, tous non authentifiés, pour 18 476 lignes

**Où** : `tests/smoke.spec.ts` (34 lignes)

**Constat** : le fichier contient exactement quatre tests. Ils vérifient que `/` redirige vers `/login`, que cinq routes protégées redirigent aussi, que deux pages publiques avec un token invalide affichent « Lien introuvable » / « Contrat introuvable », et que le formulaire de connexion valide un email vide.

Ce sont de bons tests de fumée — ils vérifient réellement quelque chose, et le troisième couvre un cas utile. Mais **aucun ne se connecte**. Par construction, tout le produit derrière `ProtectedRoute` est hors couverture, ainsi que tout parcours artisan avec un token valide.

Ce qui n'est donc couvert par aucun test : la création de projet, l'affectation d'artisan, la signature de contrat, le dépôt de devis, la saisie de montant, **le calcul de commission**, l'encaissement, le kanban, la carte, le tableau de bord, les tâches, les prospects, la génération de PDF, l'inscription artisan. Aucun test SQL ni RLS n'existe non plus, pour 60 migrations.

**Impact** : les deux défauts critiques de `03-logique-metier.md` — le taux du contrat jamais appliqué, et le montant qui ne remonte pas — sont exactement le genre de bug qu'un test d'intégration aurait capturé le jour de son introduction. Ils vivent en production depuis, silencieusement.

**Correctif** : stratégie proportionnée en annexe B. Le principe : ne pas viser une couverture globale, mais **verrouiller les dix parcours dont la casse coûte de l'argent**, et **tester la RLS et les grants en SQL** — c'est ce dernier point qui aurait attrapé les trous de `01-securite-base.md`.

**Effort** : M pour le socle, L pour les dix parcours.

---

### [ÉLEVÉ] A5-03 — La documentation décrit un produit qui n'existe plus

**Où** : `README.md:59,65,169,176,204` · `AUTOMATISATIONS.md`

**Constat** — quatre écarts, tous vérifiés :

| Le README affirme | La réalité |
|---|---|
| `:176` « migrations 0001 → 0004 » | **60 migrations** (0001 → 0060) |
| `:169` et `:204` « Application **installable** (PWA) » | Manifeste et icônes présents, mais **aucun service worker** — 0 occurrence de `serviceWorker`, `workbox` ou `vite-plugin-pwa` dans tout le dépôt. Sans gestionnaire `fetch`, Chrome ne considère pas l'application comme installable : le parcours « ajouter à l'écran d'accueil » documenté n'est pas implémenté. |
| `:59` « L'URL du webhook n8n se configure côté Supabase, **pas dans le code** » | Elle est en dur dans `src/lib/constants.ts:219` **et** dans 14 migrations SQL |
| Règle métier en tête : « **1 projet = 1 artisan assigné** (pas de candidats multiples) » | `0024_affectations.sql` a introduit le multi-artisans il y a 36 migrations. Le README décrit le modèle inverse de celui en production. |

La checklist de test manuel en 10 étapes (`:190-204`) reste largement exécutable, mais son étape 4 (« la liste affiche les artisans du même métier ») et son étape 7 (webhook) décrivent des comportements qui ont évolué.

**Impact** : c'est un risque opérationnel, pas cosmétique. Un développeur — ou vous-même dans six mois — qui suit le README pour appliquer les migrations n'en appliquera que quatre. Quelqu'un qui cherche à changer l'URL du webhook la cherchera dans Supabase et ne la trouvera pas. Et la règle « 1 projet = 1 artisan » écrite en gras en tête de document induit en erreur sur le cœur du modèle de données.

**Correctif** : reprendre le README en une passe. Trois sections à réécrire (migrations, PWA, webhook), et la règle métier de tête à corriger. Sur la PWA, deux options honnêtes : soit installer `vite-plugin-pwa` et tenir la promesse, soit retirer la mention — voir `06-perf-ux-a11y.md` pour l'arbitrage.

**Effort** : S.

---

### [ÉLEVÉ] A5-04 — Aucun rollback de migration, et des migrations réécrites après application

**Où** : `supabase/migrations/` (60 fichiers) · `scripts/generer-zones.mjs:46` · absence de `supabase/config.toml`

**Constat** : quatre faiblesses cumulées dans la gestion du schéma.

1. **Aucune migration de rollback** n'existe. Une migration qui casse la production ne peut être annulée que par une nouvelle migration écrite dans l'urgence.
2. `scripts/generer-zones.mjs:46` **réécrit `0047_zones_seed.sql`**, une migration déjà appliquée. Le fichier ne décrit alors plus ce qui a réellement été exécuté (voir A2-10).
3. **Pas de `supabase/config.toml` versionné** : la configuration du projet (dont `verify_jwt` des edge functions) n'est pas dans git.
4. `README.md:65` propose d'appliquer les migrations **en les collant dans le SQL Editor**. Rien ne garantit alors que l'ordre a été respecté ni que toutes ont été passées. C'est très probablement l'origine des `grant` manquants de A1-02.

**Impact** : personne ne peut affirmer avec certitude quel est l'état du schéma en production. C'est précisément pourquoi ce rapport s'accompagne de `audit/verification-prod.sql` — un audit de code seul ne peut pas trancher.

**Correctif** :

```bash
# Installer la CLI et lier le projet (elle n'est pas présente sur cette machine)
brew install supabase/tap/supabase
supabase link --project-ref oymnthijjbwkatrhqzvi

# Vérifier l'écart entre les migrations locales et la base réelle
supabase db diff --linked

# Versionner la configuration
supabase init   # génère supabase/config.toml → à committer
```

Puis adopter une règle simple : toute migration passe par `supabase db push`, jamais par le SQL Editor ; toute redéfinition de fonction réémet ses `grant` ; et `generer-zones.mjs` produit une **nouvelle** migration au lieu d'écraser l'ancienne.

**Effort** : M.

---

### [MOYEN] A5-05 — Les tests ne sont type-checkés par aucun tsconfig

**Où** : `tsconfig.json`, `tsconfig.app.json` (`include: ["src"]`), `tsconfig.node.json` (`include: ["vite.config.ts"]`)

**Constat** : `tests/smoke.spec.ts` et `playwright.config.ts` ne figurent dans l'`include` d'**aucun** des trois tsconfig. `tsc -b` ne les regarde jamais. Ils ne sont donc validés qu'à l'exécution de Playwright — laquelle n'a lieu dans aucune CI (A5-01).

**Impact** : un test peut contenir une erreur de type, un import cassé ou une API Playwright obsolète sans que rien ne le signale, jusqu'à ce que quelqu'un lance `npm run test:e2e` à la main. Un test qui ne compile pas est un test qui ne protège rien tout en donnant l'impression du contraire.

**Correctif** — un quatrième projet TypeScript :

```jsonc
// tsconfig.test.json
{
  "extends": "./tsconfig.app.json",
  "include": ["tests", "playwright.config.ts"],
  "compilerOptions": { "types": ["node"], "noEmit": true }
}
```

```jsonc
// tsconfig.json
{ "files": [], "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.test.json" }
] }
```

**Effort** : S.

---

### [MOYEN] A5-06 — Playwright configuré pour capturer des traces qui ne seront jamais produites

**Où** : `playwright.config.ts:10,13`

**Constat** : `trace: 'on-first-retry'` est configuré, mais **`retries` n'est jamais défini** — la valeur par défaut est 0. Il n'y a donc jamais de première réexécution, et **aucune trace n'est jamais capturée**. La configuration donne l'illusion d'un dispositif de diagnostic inexistant.

Par ailleurs, un seul projet est déclaré (`mobile-chrome`, Pixel 7). Le choix est cohérent avec un produit mobile-first, mais l'application est aussi utilisée sur desktop via la `sidebar.tsx` — non couverte.

**Correctif** :

```ts
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

`forbidOnly` évite qu'un `test.only` oublié ne réduise silencieusement la CI à un seul test.

**Effort** : S.

---

### [MOYEN] A5-07 — Aucune version de Node épinglée

**Où** : `package.json` (pas de champ `engines`) · absence de `.nvmrc` · `README.md:26`

**Constat** : aucune contrainte de version. Le README note même que Node n'était pas installé sur la machine de développement initiale. L'environnement local audité tourne sous **Node 24**, tandis que Vercel utilise par défaut une version LTS différente.

**Impact** : les builds locaux et les builds de production ne s'exécutent pas nécessairement sur le même moteur. Écart classique et coûteux à diagnostiquer : « ça marche chez moi ».

**Correctif** :

```jsonc
// package.json
"engines": { "node": ">=20 <25", "npm": ">=10" }
```

```
// .nvmrc
22
```

et fixer la même version dans le workflow CI et dans les réglages Vercel.

**Effort** : S.

---

### [MOYEN] A5-08 — Le build de production ne génère pas de sourcemaps

**Où** : `vite.config.ts` (pas de `build.sourcemap`)

**Constat** : `build.sourcemap` n'est pas configuré, donc `false` par défaut. Aucune carte de sources n'est publiée.

**Impact** : quand un artisan signale « ça ne marche pas » depuis son téléphone, la seule information disponible est une trace de pile minifiée, illisible. Sans ErrorBoundary (A4-01) ni outil de suivi d'erreurs, le diagnostic d'un incident en production repose sur la reproduction manuelle.

**Correctif** : générer les sourcemaps sans les exposer publiquement.

```ts
// vite.config.ts
build: {
  sourcemap: 'hidden',   // générées, mais non référencées depuis les bundles
  rollupOptions: { /* … manualChunks existants … */ },
}
```

`'hidden'` produit les fichiers `.map` sans y renvoyer depuis le bundle : elles restent disponibles pour un outil de suivi d'erreurs sans être servies aux visiteurs.

**Effort** : S.

---

### [MOYEN] A5-09 — Le script de déploiement n8n écrit en production sans filet

Traité en `02-securite-app.md` (A2-09). Rappel : `scripts/deploy-n8n.py` écrase un workflow d'une instance **partagée**, sans simulation, sans sauvegarde et sans confirmation, en repérant le nœud par correspondance de chaîne.

**Effort** : S.

---

### [FAIBLE] A5-10 — 6,3 Mo de captures d'écran versionnées à la racine

Traité en `02-securite-app.md` (A2-12). Quatre PNG non référencés représentant l'essentiel des 8 Mo du `.git`.

**Effort** : S.

---

### [FAIBLE] A5-11 — `.gitignore` ne couvre pas l'état local de la CLI Supabase

Traité en A1-15 / A2-11. `supabase/.temp/linked-project.json` est versionné.

**Effort** : S.

---

### [FAIBLE] A5-12 — Aucun script de vérification unique

**Où** : `package.json:7-13`

**Constat** : les scripts disponibles sont `dev`, `build`, `lint`, `preview`, `test:e2e`. Il n'existe pas de commande unique enchaînant les vérifications, ni de script `typecheck` séparé.

**Impact** : mineur, mais c'est ce qui fait qu'on oublie de lancer le lint avant de pousser.

**Correctif** :

```jsonc
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "typecheck": "tsc -b --noEmit",
  "lint": "eslint .",
  "test:e2e": "playwright test",
  "verify": "npm run typecheck && npm run lint && npm run build",
  "preview": "vite preview"
}
```

`npm run verify` devient la commande à lancer avant tout push, et la CI exécute exactement la même.

**Effort** : S.

---

## Annexe A — Workflow GitHub Actions, prêt à coller

`.github/workflows/ci.yml` :

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: Type-check · Lint · Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - run: npm ci

      - name: Type-check
        run: npx tsc -b --noEmit

      - name: Lint
        run: npx eslint .

      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

      - name: Budget de taille du bundle initial
        run: |
          TAILLE=$(du -cb dist/assets/index-*.js dist/assets/vendor-*.js | tail -1 | cut -f1)
          echo "Bundle initial : $((TAILLE / 1024)) kB"
          # Seuil volontairement posé au-dessus de l'existant (~1 702 kB) puis abaissé
          # au fur et à mesure du découpage par routes (cf. 06-perf-ux-a11y.md).
          if [ "$TAILLE" -gt 1800000 ]; then
            echo "::error::Le bundle initial dépasse 1 800 kB"
            exit 1
          fi

  audit:
    name: Vulnérabilités des dépendances
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: npm audit (production)
        run: npm audit --omit=dev --audit-level=high

  e2e:
    name: Tests end-to-end
    runs-on: ubuntu-latest
    needs: verify
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL_TEST }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY_TEST }}
          E2E_EMAIL: ${{ secrets.E2E_EMAIL }}
          E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

> **Le job `audit` échouera dès sa première exécution** à cause de jspdf (critique) et react-router (élevé). C'est le comportement attendu : corriger d'abord (`02-securite-app.md`, A2-02 et A2-05), poser la CI ensuite. Ne pas abaisser `--audit-level` pour faire passer le job.

**Protection de branche** — dans *Settings → Branches → Add rule* sur `main` : exiger le passage de `verify` et `audit` avant fusion, et interdire le push direct. Sans cela, le workflow signale sans empêcher.

**Hook pre-commit léger** — pour attraper les erreurs avant même le push, sans ralentir chaque commit :

```bash
npm i -D husky lint-staged
npx husky init
printf 'npx lint-staged\n' > .husky/pre-commit
```

```jsonc
// package.json
"lint-staged": { "*.{ts,tsx}": ["eslint --fix"] }
```

Volontairement limité au lint : un `tsc` complet à chaque commit serait trop lent pour être accepté, et la CI s'en charge.

---

## Annexe B — Stratégie de test proportionnée

Le principe directeur : à deux personnes sur un produit interne, viser une couverture globale serait irréaliste et abandonné en deux semaines. Il faut **verrouiller ce dont la casse coûte de l'argent ou de la crédibilité**, et rien d'autre.

### Les dix parcours à couvrir en priorité

Classés par coût d'une régression, du plus élevé au moins élevé :

| # | Parcours | Pourquoi | Type |
|---|---|---|---|
| 1 | Montant du devis signé → commission correcte en base | Le cœur du modèle économique. Deux bugs critiques y vivent déjà (A3-01, A3-02). | pgTAP |
| 2 | RLS et grants : `anon` ne peut rien lire des tables | Ce qui aurait attrapé A1-02 et A1-08. | pgTAP |
| 3 | Signature de contrat via `/signer/:token` | Acte contractuel, page publique. | e2e |
| 4 | Dépôt de devis + saisie de montant depuis `/artisan/:token` | Le parcours artisan le plus utilisé. | e2e |
| 5 | Création de projet + géocodage | Point d'entrée de toute la chaîne. | e2e authentifié |
| 6 | Affectation d'un artisan à un projet | Écriture multi-tables non transactionnelle (A3-08). | e2e authentifié |
| 7 | Transitions de statut projet/affectation | Machine à états sans contrainte (A3-05, A3-06). | pgTAP |
| 8 | Inscription artisan via `/rejoindre` | Écriture publique non authentifiée (A1-04). | e2e |
| 9 | Encaissement de commission | Donnée financière. | e2e authentifié |
| 10 | Génération du PDF de devis | Dépendance critique (jspdf, A2-02). | unitaire |

### Socle 1 — Tests pgTAP sur la RLS et les grants

C'est le meilleur rapport valeur/effort de tout ce rapport : quelques dizaines de lignes de SQL qui auraient détecté les deux défauts critiques de `01-securite-base.md`.

```sql
-- supabase/tests/rls.test.sql — s'exécute avec `supabase test db`
begin;
select plan(8);

-- 1. Toutes les tables du schéma public ont la RLS activée
select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'Toutes les tables publiques ont la RLS activée');

-- 2. Aucune fonction SECURITY DEFINER n'a EXECUTE ouvert à PUBLIC
select is_empty(
  $$ select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proacl is null $$,
  'Aucune fonction SECURITY DEFINER avec EXECUTE public par défaut');

-- 3. Le rôle anon ne lit aucune donnée métier
set local role anon;
select throws_ok($$ select * from public.projets $$,        NULL, NULL, 'anon ne lit pas projets');
select throws_ok($$ select * from public.artisans $$,       NULL, NULL, 'anon ne lit pas artisans');
select is_empty($$ select * from public.contrats $$,        'anon ne voit aucun contrat');
reset role;

-- 4. Les buckets sensibles ne sont pas publics
select is_empty(
  $$ select id from storage.buckets where public and id in ('devis','projet-photos','documents') $$,
  'Aucun bucket sensible en accès public');

-- 5. Les taux de commission restent dans les bornes contractuelles
select is_empty(
  $$ select id from public.artisans
     where taux_commission is not null
       and (taux_commission < 0.05 or taux_commission > 0.30) $$,
  'Aucun taux de commission hors bornes');

-- 6. Aucun montant négatif
select is_empty(
  $$ select id from public.projets where montant_devis_signe < 0 $$,
  'Aucun montant de devis signé négatif');

select * from finish();
rollback;
```

Ces tests **échoueront tant que les correctifs de `01-securite-base.md` ne sont pas appliqués** — c'est leur intérêt : ils transforment ce rapport en critère vérifiable, et empêchent toute régression future.

### Socle 2 — Session authentifiée Playwright

Aujourd'hui, aucun test ne se connecte. Un état de session réutilisable débloque tout le reste.

```ts
// tests/auth.setup.ts
import { test as setup, expect } from '@playwright/test'

const FICHIER_SESSION = 'tests/.auth/session.json'

setup('authentification', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
  await page.getByLabel('Mot de passe').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.context().storageState({ path: FICHIER_SESSION })
})
```

```ts
// playwright.config.ts — ajouter aux projects
{ name: 'setup', testMatch: /auth\.setup\.ts/ },
{
  name: 'mobile-authentifie',
  use: { ...devices['Pixel 7'], storageState: 'tests/.auth/session.json' },
  dependencies: ['setup'],
},
```

À utiliser **contre un projet Supabase de test**, jamais contre la production : les tests créent des projets, des artisans et des contrats.

### Socle 3 — Le test qui aurait attrapé le bug de commission

Une fois la session en place, le parcours n°1 devient testable de bout en bout :

```ts
// tests/commission.spec.ts
test('le taux du contrat est bien celui appliqué à la commission', async ({ page, request }) => {
  // 1. Inscription d'un artisan à 15 %
  await page.goto('/rejoindre?taux=15')
  await page.getByLabel('Société').fill('Test SARL ' + Date.now())
  await page.getByRole('button', { name: /continuer/i }).click()
  // … signature du contrat …

  // 2. Le contrat affiche bien 15 %
  await expect(page.getByText(/15\s*%/)).toBeVisible()

  // 3. Après affectation d'un projet et saisie d'un devis signé de 20 000 €,
  //    la commission doit valoir 3 000 € — et non 2 000 €.
  const projet = await recupererProjetTest(request)
  expect(projet.taux_commission).toBe(0.15)
  expect(projet.commission).toBe(3000)
})
```

Écrit aujourd'hui, ce test **échoue** — il documente le bug A3-01 et devient le critère de sa correction.

### Ce qu'il ne faut pas faire

Ne pas viser un pourcentage de couverture. Ne pas introduire vitest pour tester des composants d'affichage : sur ce produit, un test de rendu de `KpiTile` ne protège de rien. Ne pas écrire de tests unitaires sur les hooks — ils ne feraient que dupliquer l'API de react-query. La valeur est dans les tests SQL (socle 1) et les parcours de bout en bout (socles 2 et 3) ; le reste est du bruit.

---

## Ce qui est bien fait

- **`tsc` et `eslint` passent sans une seule erreur**, sur 18 476 lignes, sans CI pour l'imposer. C'est le point le plus notable de ce volet.
- **Le build est rapide et fiable** : 3,05 s pour 4 048 modules.
- **`tsconfig.app.json` va au-delà des réglages par défaut** : `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUncheckedSideEffectImports`.
- **Le `manualChunks` de `vite.config.ts:18-25` est déjà pensé** — six chunks vendors séparés. Le problème n'est pas le découpage mais l'absence de chargement différé (`06-perf-ux-a11y.md`).
- **Les quatre tests existants sont pertinents**, en particulier celui qui vérifie que les pages publiques ne plantent pas avec un token invalide. Le socle est petit mais sain — il n'y a rien à jeter, seulement à étendre.
- **`.gitignore` couvre correctement les fichiers d'environnement**, y compris les variantes `.env.secrets*`.
- **`scripts/ops-env.sh` sépare proprement les secrets d'exploitation** du dépôt, dans un fichier gitignoré.
- **Les migrations sont numérotées séquentiellement et commentées**, souvent avec la raison du changement. Sur 60 fichiers écrits au fil de l'eau, la lisibilité reste bonne — c'est ce qui a rendu cet audit possible.
