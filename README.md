# CRM Celexia

CRM web **mobile-first** pour la mise en relation **client ↔ artisan**.
Deux associés (Thomas & Antoine) y gèrent les **artisans**, les **projets/clients**, les **devis/contrats**
et le **suivi de l'argent** (CA généré, commission 10 %, encaissement). Saisie rapide, utilisable d'une main
pendant un appel.

> Règle métier : **1 projet = 1 artisan assigné** (pas d'enchères / candidats multiples).

---

## Stack

- **Vite + React 19 + TypeScript** · **react-router-dom v7**
- **Tailwind CSS v4** (plugin `@tailwindcss/vite`, config CSS-first dans `src/index.css`) + `tw-animate-css`
- **shadcn/ui** (style *new-york*, base *neutral*, accent **violet #7C3AED**) · icônes **lucide-react**
- **@supabase/supabase-js** + **@tanstack/react-query**
- **react-leaflet + leaflet** (tuiles OpenStreetMap, **gratuit, sans clé**)
- **recharts** (dashboard) · **sonner** (toasts) · **zod + react-hook-form** · **date-fns**
- Géocodage adresse → lat/lng via **Nominatim** (OpenStreetMap, gratuit, sans clé)

---

## Prérequis

- **Node.js 20+ LTS** et npm. *(Non installé sur la machine de dev initiale — à installer : https://nodejs.org)*
- Un projet **Supabase** (gratuit).

---

## Installation & lancement local

```bash
# 1. Dépendances
npm install

# 2. Variables d'environnement
cp .env.example .env.local
#   puis renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY

# 3. Lancer en dev
npm run dev          # http://localhost:5173

# Autres commandes
npm run build        # build de production (tsc + vite)
npm run preview      # prévisualiser le build
npm run lint         # ESLint
npm run test:e2e     # tests Playwright (cf. /tests)
```

### Variables d'environnement (`.env.local`)

| Variable                 | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `VITE_SUPABASE_URL`      | URL du projet Supabase (Settings → API)             |
| `VITE_SUPABASE_ANON_KEY` | Clé publique **anon** (Settings → API)              |

> ⚠️ **SPA** : seule la clé **anon** est exposée dans le front (c'est normal, la sécurité passe par la **RLS**).
> On n'embarque **JAMAIS** la `service_role` key côté front. L'URL du webhook n8n se configure côté Supabase,
> pas dans le code (voir plus bas).

---

## Mise en place Supabase

### 1. Migrations (schéma)

Les migrations SQL versionnées sont dans [`/supabase/migrations`](./supabase/migrations) :

| Fichier                  | Contenu                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `0001_init_schema.sql`   | Tables `artisans` et `projets` (+ index, commission auto 10 %) |
| `0002_triggers.sql`      | Trigger `updated_at = now()` sur les 2 tables                 |
| `0003_rls.sql`           | RLS : accès complet pour tout utilisateur **authentifié**     |
| `0004_storage.sql`       | Bucket privé `documents` + policies (accès authentifié)       |

**Appliquer** — au choix :

- **Dashboard** : Supabase → *SQL Editor* → coller le contenu de chaque fichier **dans l'ordre** → *Run*.
- **CLI** : `supabase db push` (si tu utilises la Supabase CLI liée au projet).

> La colonne `commission` est **calculée par la base** (`montant_devis_signe * 0.10`). Elle n'est **jamais**
> calculée côté front.

### 2. Créer les 2 comptes (Thomas & Antoine)

La création de comptes nécessite des droits admin → on la fait **à la main dans le dashboard** :

1. Supabase → **Authentication → Users → Add user**.
2. Créer **Thomas** : son email + un mot de passe (cocher *Auto Confirm User*).
3. Créer **Antoine** : idem.

Les deux comptes ont un **accès identique** (lecture/écriture complète) grâce à la politique RLS.
Aucun rôle avancé. La connexion se fait ensuite sur `/login`.

### 3. Bucket Storage

Le bucket privé `documents` est créé par `0004_storage.sql`. Les 3 PDF d'un projet
(contrat / devis / devis signé) y sont stockés ; l'app génère des **URLs signées** (valables 1h)
pour les consulter.

---

## Webhook n8n — notification « devis signé »

Quand un projet passe au statut **`devis_signe`**, on notifie Thomas & Antoine via **n8n**.
Approche retenue (SPA, donc pas de code serveur) : **Database Webhook** Supabase.

### Configuration (Dashboard Supabase)

1. Supabase → **Database → Webhooks → Create a new hook**.
2. **Table** : `projets` · **Events** : cocher **Update**.
3. **Type** : *HTTP Request* · **Method** : `POST` · **URL** : ton `N8N_WEBHOOK_URL`.
4. Enregistrer.

Le webhook envoie à chaque update un corps JSON Supabase de la forme :

```json
{
  "type": "UPDATE",
  "table": "projets",
  "record": { "...": "ligne projet à jour (avec statut, montant_devis_signe, commission, artisan_id, ...)" },
  "old_record": { "...": "ligne projet avant update" }
}
```

### Côté n8n

1. **Nœud IF** (ne réagir qu'au passage à *devis signé*) :
   - `{{$json.body.record.statut}}` **=** `devis_signe`
   - **ET** `{{$json.body.old_record.statut}}` **≠** `devis_signe`
2. (Optionnel) **Nœud Supabase / HTTP** : récupérer l'artisan via `record.artisan_id`
   pour obtenir « Nom Société ».
3. **Construire le payload** attendu, puis envoyer l'email/SMS :

```json
{
  "event": "devis_signe",
  "projet_id": "{{$json.body.record.id}}",
  "client_nom": "{{$json.body.record.client_nom}}",
  "client_ville": "{{$json.body.record.client_ville}}",
  "metier": "{{$json.body.record.metier}}",
  "artisan": "Nom Société",
  "montant_devis_signe": "{{$json.body.record.montant_devis_signe}}",
  "commission": "{{$json.body.record.commission}}"
}
```

> Conçu pour ajouter d'autres webhooks plus tard sans refactor (un hook = un événement).

---

## Déploiement (Vercel)

1. Importer le repo GitHub dans **Vercel**.
2. **Framework preset** : *Vite*. Build : `npm run build` · Output : `dist`.
3. **Environment Variables** : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. Déployer. Ajouter une *rewrite* SPA si besoin (Vercel le gère par défaut pour Vite).

---

## Identité visuelle (DA)

Reprise des repos Celexia :
- **Violet** primaire `#7C3AED` (hover `#6D28D9`), échelle 50→950.
- Polices **Plus Jakarta Sans** (corps/UI) + **Clash Display** (titres, KPIs, montants, `tabular-nums`).
- Couleurs sémantiques des statuts (badges + pins carte) :
  `nouveau` #64748B · `artisan_assigne` #3B82F6 · `devis_envoye` #F59E0B · `devis_signe` #22C55E · `perdu` #EF4444.
- Logo + favicons + icônes PWA dans [`/public`](./public). Application **installable** (PWA).

---

## Structure du projet

```
public/                logo, favicons, icônes PWA, manifest.webmanifest
supabase/migrations/   0001 → 0004 (schéma, triggers, RLS, storage)
src/
  app/                 App (routes), providers (react-query + toasts), layout (header + bottom nav)
  lib/                 supabase/client, auth/, geocoding (Nominatim), storage (URLs signées), format, constants
  components/          BrandLogo, PageHeader, StatutBadge, EmptyState + ui/ (shadcn)
  features/
    auth/              page de connexion
    artisans/          hooks + pages (liste, new, edit, fiche) + formulaire
    projets/           hooks + pages (liste, new, edit, fiche) + assignation / montants / documents
    carte/             carte Leaflet (pins artisans + projets)
    dashboard/         KPIs (recharts)
```

---

## Checklist de test manuel (bout en bout)

1. `npm install` puis `npm run dev` → l'app se lance ; connexion OK avec un compte créé dans le dashboard.
2. **Artisans → Nouvel artisan** (avec adresse) → enregistré, **pin** visible sur la **Carte**.
3. **Projets → Nouveau projet** (formulaire d'appel) → enregistré + géocodé.
4. Sur la **fiche projet** → **Assigner un artisan** : la liste affiche les artisans du **même métier**, triés
   par **proximité** → assignation en un tap (statut passe à *artisan assigné*).
5. **Uploader** contrat / devis (PDF) → bouton **Voir** ouvre le document via URL signée.
6. Saisir **montant devis signé** → **commission (10 %)** affichée automatiquement.
7. Passer le statut à **Devis signé** → le **webhook n8n** reçoit le payload (vérifier côté n8n).
8. Cocher **commission encaissée** → le **dashboard** se met à jour (CA, commission encaissée / à encaisser).
9. **Fiche artisan** → historique des projets + **total rapporté** corrects.
10. Vérifier le **mobile** (bottom nav, cibles ≥ 48px) et l'**installation PWA** (ajouter à l'écran d'accueil).
